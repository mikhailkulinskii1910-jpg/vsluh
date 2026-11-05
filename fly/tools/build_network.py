"""
Строит подсеть мозга мухи из открытого коннектома FlyWire для веб-симуляции.

Источники (открытые данные):
  - связи:       FlyWire Whole-brain Connectome Connectivity Data (Zenodo 10676866),
                 файл proofread_connections_783.feather
  - аннотации:   flyconnectome/flywire_annotations v3.2.0 (Zenodo 23037340),
                 Supplemental_file1_neuron_annotations.tsv

Запуск:
  python3 build_network.py --connections proofread_connections_783.feather \
                           --annotations Supplemental_file1_neuron_annotations.tsv \
                           --out ../data/fly_network.json --max-neurons 2000
"""
import argparse
import json

import numpy as np
import pandas as pd

INHIBITORY_NT = {"gaba", "glutamate"}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--connections", required=True)
    p.add_argument("--annotations", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max-neurons", type=int, default=2000)
    p.add_argument("--inputs-per-group", type=int, default=40)
    args = p.parse_args()

    ann = pd.read_csv(args.annotations, sep="\t", low_memory=False,
                      usecols=["root_id", "super_class", "cell_class", "top_nt",
                               "side", "soma_x", "soma_y", "soma_z", "pos_x", "pos_y",
                               "pos_z", "cell_type"])
    ann = ann.drop_duplicates("root_id").set_index("root_id")
    ann["side"] = ann["side"].fillna("na")
    ann["top_nt"] = ann["top_nt"].fillna("unknown")
    ann["cell_type"] = ann["cell_type"].fillna(ann.index.to_series().astype(str))

    conn = pd.read_feather(args.connections,
                           columns=["pre_pt_root_id", "post_pt_root_id", "syn_count"])
    conn = conn[conn.pre_pt_root_id.isin(ann.index) & conn.post_pt_root_id.isin(ann.index)]
    conn = (conn.groupby(["pre_pt_root_id", "post_pt_root_id"], as_index=False)["syn_count"]
                .sum())
    print("aggregated pairs:", len(conn))

    # ---- Группы входов и выходов -------------------------------------------
    def pick(mask, n_per_side):
        chosen = []
        sub = ann[mask]
        out_syn = conn.groupby("pre_pt_root_id")["syn_count"].sum()
        for side in ["left", "right"]:
            s = sub[sub.side == side].index
            scores = out_syn.reindex(s).fillna(0).sort_values(ascending=False)
            chosen += list(scores.index[:n_per_side])
        return chosen

    n = args.inputs_per_group
    groups = {
        "olfactory": pick(ann.cell_class.eq("olfactory"), n),
        "mechanosensory": pick(ann.cell_class.eq("mechanosensory"), n // 2),
    }
    motor = ann[ann.super_class.eq("motor")]
    groups["motor"] = list(motor.index)

    seeds = set(sum(groups.values(), []))
    print({k: len(v) for k, v in groups.items()})

    # ---- Расширение подсети: нейроны, связанные с входами -----------------
    inputs = set(groups["olfactory"] + groups["mechanosensory"])
    from_inputs = conn[conn.pre_pt_root_id.isin(inputs)]
    hidden_score = (from_inputs.groupby("post_pt_root_id")["syn_count"].sum()
                    .sort_values(ascending=False))
    hidden_score = hidden_score[~hidden_score.index.isin(seeds)]

    budget = args.max_neurons - len(seeds)
    hidden = list(hidden_score.index[:budget])
    nodes = list(seeds) + hidden
    node_set = set(nodes)
    print("nodes:", len(nodes))

    sub = conn[conn.pre_pt_root_id.isin(node_set) & conn.post_pt_root_id.isin(node_set)]
    sub = sub[sub.syn_count >= 2]
    print("edges:", len(sub))

    index = {rid: i for i, rid in enumerate(nodes)}
    group_of = {}
    for name, ids in groups.items():
        for rid in ids:
            group_of.setdefault(rid, name)

    a = ann.loc[nodes]
    # Координаты сомы; если их нет, берём точку на отростке (pos_x/y/z)
    soma = a[["soma_x", "soma_y", "soma_z"]].to_numpy(dtype=float)
    fallback = a[["pos_x", "pos_y", "pos_z"]].to_numpy(dtype=float)
    pos = np.where(np.isnan(soma), fallback, soma)
    pos = np.nan_to_num(pos, nan=0.0)
    print("neurons without soma position:", int(np.isnan(soma).any(axis=1).sum()))
    pos -= pos.mean(axis=0)
    pos /= np.abs(pos).max()

    nt_list = sorted(a.top_nt.unique())
    cls_list = sorted(a.cell_class.fillna("na").unique())
    side_list = ["left", "right", "center", "na"]
    group_list = ["olfactory", "mechanosensory", "motor", "hidden"]

    data = {
        "meta": {
            "source": "FlyWire (Zenodo 10676866 connectivity; Zenodo 23037340 annotations)",
            "neurons": len(nodes),
            "edges": int(len(sub)),
            "note": "Subnetwork for demo. Positions are soma centers normalized to [-1,1].",
        },
        "ids": [str(r) for r in nodes],
        "pos": np.round(pos, 4).reshape(-1).tolist(),
        "group": [group_list.index(group_of.get(r, "hidden")) for r in nodes],
        "nt_list": nt_list,
        "nt": [nt_list.index(x) for x in a.top_nt],
        "cls_list": cls_list,
        "cls": [cls_list.index(x) for x in a.cell_class.fillna("na")],
        "side_list": side_list,
        "side": [side_list.index(x) for x in a.side],
        "cell_type": a.cell_type.astype(str).tolist(),
        "groups": {k: [index[r] for r in v] for k, v in groups.items()},
        "src": [index[r] for r in sub.pre_pt_root_id],
        "dst": [index[r] for r in sub.post_pt_root_id],
        "syn": sub.syn_count.astype(int).tolist(),
    }
    pre_nt = a.top_nt.reindex(sub.pre_pt_root_id.values).to_numpy()
    data["inhibitory"] = [1 if x in INHIBITORY_NT else 0 for x in pre_nt]

    with open(args.out, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print("wrote", args.out)


if __name__ == "__main__":
    main()
