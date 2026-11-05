'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../js/routing.js');

/** Минимальный ответ BRouter: 3 точки, 2 участка (велодорожка 300 м + дорога 100 м). */
function brouter(withTags = true) {
  const hdr = ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy'];
  return {
    features: [{
      properties: {
        'track-length': '400', 'total-time': '90', 'filtered ascend': '5',
        messages: [hdr,
          ['37001000', '55001000', '150', '300', '0', '0', '0', '0', '0', withTags ? 'highway=cycleway surface=asphalt' : '', '', '0', '0'],
          ['37002000', '55002000', '150', '100', '0', '0', '0', '0', '0', withTags ? 'highway=residential' : '', '', '0', '0']],
      },
      geometry: { coordinates: [[37.0, 55.0, 150], [37.001, 55.001, 150], [37.002, 55.002, 150]] },
    }],
  };
}

test('теги: велодорожка, велополоса, обозначенная тропа — велоинфраструктура', () => {
  assert.equal(R.isBikeTags('highway=cycleway'), true);
  assert.equal(R.isBikeTags('highway=primary cycleway:right=track'), true);
  assert.equal(R.isBikeTags('highway=footway bicycle=designated'), true);
  assert.equal(R.isBikeTags('highway=residential route_bicycle_lcn=yes'), true);
  assert.equal(R.isBikeTags('highway=primary cycleway=no'), false);
  assert.equal(R.isBikeTags('highway=primary cycleway=shared_lane'), false);
  assert.equal(R.isBikeTags('highway=residential'), false);
});

test('разбор ответа: доля велодорожек и флаги по точкам', () => {
  const r = R.parseBRouter(brouter());
  assert.equal(r.distance, 400);
  assert.equal(r.coords.length, 3);
  assert.equal(r.bikeShare, 0.75);
  assert.deepEqual(r.bikeFlags.slice(1), [true, false]);
});

test('профиль без тегов — доля неизвестна (null)', () => {
  const r = R.parseBRouter(brouter(false));
  assert.equal(r.bikeShare, null);
  assert.equal(r.bikeFlags, null);
});

test('выбор: допуск 0% — даже +1,5% ради велодорожек не берётся', () => {
  const fast = { distance: 10000, ascent: 0, bikeShare: 0.05 };
  const bike = { distance: 10150, ascent: 0, bikeShare: 0.60 };
  const best = R.pickBest([fast, bike]);
  assert.equal(best.bikeShare, 0.05);
  assert.equal(best.extraM, 0);
});

test('выбор: среди равных по стоимости — больше велодорожек', () => {
  const a = { distance: 10760, ascent: 34, bikeShare: 0.0 };
  const b = { distance: 10760, ascent: 34, bikeShare: 0.84 };
  assert.equal(R.pickBest([a, b]).bikeShare, 0.84);
});

test('выбор: самый короткий вариант с велодорожками (Сокольники → Измайлово)', () => {
  const fast = { distance: 7380, ascent: 29, bikeShare: 0.15 };
  const safety = { distance: 7000, ascent: 35, bikeShare: 0.38 };
  assert.equal(R.pickBest([fast, safety]).bikeShare, 0.38);
});

test('выбор: +5,8% ради велодорожек — уже вне допуска (Красная пл. → ВДНХ)', () => {
  const fast = { distance: 9340, ascent: 17, bikeShare: 0.03 };
  const safety = { distance: 9870, ascent: 20, bikeShare: 0.42 };
  const trek = { distance: 10640, ascent: 17, bikeShare: 0.04 };
  assert.equal(R.pickBest([fast, safety, trek]).bikeShare, 0.03);
});

test('выбор: долгий вариант с велодорожками за пределами допуска не берётся', () => {
  const fast = { distance: 5000, ascent: 0, bikeShare: 0.1 };
  const detour = { distance: 6000, ascent: 0, bikeShare: 0.9 }; // +20%
  assert.equal(R.pickBest([fast, detour]).bikeShare, 0.1);
});

test('выбор: с допуском — при равной доле велодорожек более короткий', () => {
  const a = { distance: 7240, ascent: 0, bikeShare: 0.34 };
  const b = { distance: 7000, ascent: 0, bikeShare: 0.345 };
  assert.equal(R.pickBest([a, b], 0.07).distance, 7000);
});

test('раскраска: отрезки по типу дороги', () => {
  const coords = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const runs = R.splitByBike(coords, [false, true, true, false]);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].bike, true);
  assert.equal(runs[0].coords.length, 3);
  assert.equal(runs[1].bike, false);
});

test('штраф: дворовые проезды и пешеходные дорожки дороже, велодорожка — со скидкой', () => {
  assert.equal(R.wayPenalty('highway=residential', 100), 0);
  assert.ok(R.wayPenalty('highway=service service=parking_aisle', 100) > R.wayPenalty('highway=service', 100));
  assert.ok(R.wayPenalty('highway=footway', 100) > 0);
  assert.ok(R.wayPenalty('highway=cycleway', 100) < 0);
  assert.ok(R.wayPenalty('highway=footway bicycle=designated', 100) < 0);
  assert.equal(R.isYardTags('highway=service'), true);
  assert.equal(R.isYardTags('highway=footway bicycle=designated'), false);
});

test('штраф: путь через дворы проигрывает чуть более длинной дороге (Раменки)', () => {
  // зигзаг между домами: 3 разворота на дворовых проездах
  const zig = [[55.7, 37.5], [55.7009, 37.5], [55.7009, 37.5003], [55.7, 37.5003], [55.7, 37.5006], [55.7009, 37.5006], [55.7009, 37.5009]];
  const yard = zig.map(() => true), road = zig.map(() => false);
  assert.ok(R.turnPenalty(zig, yard) > 0);
  assert.equal(R.turnPenalty(zig, road), 0, 'на дорогах «развороты» геометрии не штрафуются');
  const yards = { distance: 1070, ascent: 0, bikeShare: 0, penaltyM: 1168 };
  const roads = { distance: 1450, ascent: 0, bikeShare: 0, penaltyM: 370 };
  assert.equal(R.pickBest([yards, roads]).distance, 1450);
});

test('штраф: проезжая часть больших улиц дороже тротуара вдоль неё', () => {
  assert.ok(R.wayPenalty('highway=primary', 100) > R.wayPenalty('highway=footway footway=sidewalk', 100));
  assert.ok(R.wayPenalty('highway=secondary', 100) > R.wayPenalty('highway=footway', 100));
  assert.equal(R.wayPenalty('highway=primary cycleway:right=lane', 100), -10, 'с велополосой — уже велоинфраструктура');
});

test('профиль velo.brf: тротуары дешёвые, проспекты дорогие', () => {
  const brf = require('fs').readFileSync(require('path').join(__dirname, '../../js/velo.brf'), 'utf8');
  assert.match(brf, /footway=sidewalk\|crossing then 1\.05/);
  assert.match(brf, /highway=primary\|primary_link {5}\) then \( if isbike then 1\.2 else {2}5 {2}\)/);
  assert.match(brf, /else if footaccess then \( if bicycle=dismount then 1\.5 else 0\.3 \)/);
});
