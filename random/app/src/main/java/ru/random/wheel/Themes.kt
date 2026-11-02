package ru.random.wheel

/** Шрифт темы. */
enum class Font(val family: String) {
    SANS("sans-serif"), SERIF("serif"), MONO("monospace"), CONDENSED("sans-serif-condensed")
}

/** Как рисуются сектора: заливка, объёмный градиент или неоновый контур. */
enum class Sectors { SOLID, GRADIENT, OUTLINE }

/** Фон экрана. */
enum class Backdrop { SOLID, GRADIENT, DOTS, STARS, PHOTO }

/**
 * Тема оформления: цвета интерфейса, палитра секторов и стиль — шрифт, скругление кнопок,
 * вид секторов, фон, толщина обода. Стиль делает темы разными не только по цвету.
 */
data class AppTheme(
    val id: String,
    val title: String,
    val bg: Int,
    val panel: Int,
    val text: Int,
    val muted: Int,
    val accent: Int,
    val onAccent: Int,
    val rim: Int,
    val light: Boolean,
    val palette: IntArray,
    val font: Font = Font.SANS,
    val corners: Int = 14,
    val sectors: Sectors = Sectors.SOLID,
    val backdrop: Backdrop = Backdrop.SOLID,
    val rimWidth: Float = 5f,
    /** Фото для фона [Backdrop.PHOTO] (ресурс drawable). */
    val photo: Int = 0,
)

object Themes {
    private fun c(hex: Long) = (0xFF000000 or hex).toInt()
    private fun p(vararg hex: Long) = IntArray(hex.size) { c(hex[it]) }

    private val base = listOf(
        AppTheme("night", "Ночь", c(0x15161C), c(0x22242E), c(0xF2F2F5), c(0x9A9CA8), c(0xFFC93C), c(0x15161C), c(0xF2F2F5), false,
            p(0xE84A5F, 0xFF8C42, 0xFFC93C, 0x8AC926, 0x2EC4B6, 0x3A86FF, 0x8338EC, 0xFF5DA2, 0x06D6A0, 0x118AB2, 0xF15BB5, 0xB5838D)),
        AppTheme("day", "День", c(0xF4F5F8), c(0xFFFFFF), c(0x1B1C22), c(0x6B6E7B), c(0x3A6FF7), c(0xFFFFFF), c(0x2B2D38), true,
            p(0xE84A5F, 0xFF8C42, 0xFFC93C, 0x8AC926, 0x2EC4B6, 0x3A86FF, 0x8338EC, 0xFF5DA2, 0x06D6A0, 0x118AB2, 0xF15BB5, 0xB5838D)),
        AppTheme("neon", "Неон", c(0x0B0221), c(0x1C0C3F), c(0xF8F0FF), c(0xA08CC8), c(0xFF2E97), c(0xFFFFFF), c(0x00F0FF), false,
            p(0xFF2E97, 0x00F0FF, 0xB026FF, 0x39FF14, 0xFFE600, 0xFF6B00, 0x7B2FFF, 0x00FFA3)),
        AppTheme("ocean", "Океан", c(0x0A1F2E), c(0x12344A), c(0xE6F7FF), c(0x8FB3C6), c(0x00C2D1), c(0x0A1F2E), c(0xE6F7FF), false,
            p(0x0077B6, 0x00B4D8, 0x90E0EF, 0x48CAE4, 0x023E8A, 0x2EC4B6, 0x0096C7, 0xCAF0F8)),
        AppTheme("sunset", "Закат", c(0x2A1325), c(0x3D1D36), c(0xFFEFE6), c(0xC99AAE), c(0xFF7B54), c(0x2A1325), c(0xFFEFE6), false,
            p(0xFF7B54, 0xFFB26B, 0xFFD56F, 0xE84A5F, 0xB83B5E, 0x6A2C70, 0xF08A5D, 0xF9ED69)),
        AppTheme("pastel", "Пастель", c(0xFFF7F0), c(0xFFFFFF), c(0x3D3A4B), c(0x8E8A9C), c(0xE88FB0), c(0x3D3A4B), c(0x3D3A4B), true,
            p(0xFFADAD, 0xFFD6A5, 0xFDFFB6, 0xCAFFBF, 0x9BF6FF, 0xA0C4FF, 0xBDB2FF, 0xFFC6FF)),
        AppTheme("forest", "Лес", c(0x102016), c(0x1B3324), c(0xEEF6E8), c(0x9DB59F), c(0xA7C957), c(0x102016), c(0xEEF6E8), false,
            p(0x386641, 0x6A994E, 0xA7C957, 0xF2E8CF, 0xBC4749, 0xDDA15E, 0x606C38, 0x8AB17D)),
        AppTheme("mono", "Монохром", c(0x000000), c(0x1A1A1A), c(0xFFFFFF), c(0x8C8C8C), c(0xFFFFFF), c(0x000000), c(0xFFFFFF), false,
            p(0x2B2B2B, 0x4A4A4A, 0x6E6E6E, 0x939393, 0xB8B8B8, 0xDCDCDC)),
        AppTheme("sakura", "Сакура", c(0xFFF0F5), c(0xFFFFFF), c(0x4A2C3A), c(0xA07C8C), c(0xE75480), c(0xFFFFFF), c(0x4A2C3A), true,
            p(0xFFB7C5, 0xF06292, 0xFFD1DC, 0xBA68C8, 0xF8BBD0, 0xE91E63, 0xCE93D8, 0xFF80AB)),
        AppTheme("space", "Космос", c(0x070B1A), c(0x151B33), c(0xE8EAFF), c(0x8A90B8), c(0x7C83FD), c(0xFFFFFF), c(0xC9CCFF), false,
            p(0x7C83FD, 0x96BAFF, 0x7DEDFF, 0x88FFF7, 0xB388EB, 0x5E60CE, 0x48BFE3, 0xF72585)),
        AppTheme("cyber", "Кибер", c(0x0D0D0D), c(0x1F1F1F), c(0xF5F5F5), c(0x8F8F8F), c(0xFCEE0A), c(0x0D0D0D), c(0xFCEE0A), false,
            p(0xFCEE0A, 0x00F0FF, 0xFF003C, 0x7A00FF, 0x00FF9F, 0xFF7A00)),
        AppTheme("mint", "Мята", c(0xEFFAF5), c(0xFFFFFF), c(0x1E3D34), c(0x6F8F85), c(0x2BB38A), c(0xFFFFFF), c(0x1E3D34), true,
            p(0x98E2C6, 0x2BB38A, 0xC7F0DB, 0x6CC4A1, 0xA0E7E5, 0x3D9970, 0xB4F8C8, 0x5FD3BC)),
        AppTheme("coffee", "Кофе", c(0x1E1611), c(0x2E231C), c(0xF3E9DC), c(0xB09A85), c(0xC8A27A), c(0x1E1611), c(0xF3E9DC), false,
            p(0x6F4E37, 0xA47148, 0xC8A27A, 0xE6CCB2, 0x7F5539, 0xDDB892, 0x9C6644, 0xB08968)),
        AppTheme("lava", "Лава", c(0x140606), c(0x2A0E0E), c(0xFFE8DC), c(0xC08A7A), c(0xFF4500), c(0xFFFFFF), c(0xFFB347), false,
            p(0xFF4500, 0xFF8C00, 0xFFD700, 0xB22222, 0xFF6347, 0x8B0000, 0xFFA07A, 0xDC143C)),
        AppTheme("arctic", "Арктика", c(0xEEF4FA), c(0xFFFFFF), c(0x1D2B3A), c(0x6B7D90), c(0x4A90D9), c(0xFFFFFF), c(0x1D2B3A), true,
            p(0xA8D8F0, 0x4A90D9, 0xD6EAF8, 0x7FB3D5, 0x85C1E9, 0x2E86C1, 0xAED6F1, 0x5DADE2)),
        AppTheme("gold", "Золото", c(0x111111), c(0x1E1B14), c(0xF5E6C4), c(0xA8996F), c(0xD4AF37), c(0x111111), c(0xD4AF37), false,
            p(0xD4AF37, 0x262626, 0xF0D78C, 0x3A3A3A, 0xB8860B, 0x1A1A1A)),
        AppTheme("retro", "Ретро", c(0xF4ECD8), c(0xFFF8E7), c(0x3B2F2F), c(0x8C7B6B), c(0xD9480F), c(0xFFFFFF), c(0x3B2F2F), true,
            p(0xE63946, 0xF4A261, 0x2A9D8F, 0xE9C46A, 0x264653, 0xF28482)),
        AppTheme("raspberry", "Малина", c(0x1F0A14), c(0x341424), c(0xFFE6F0), c(0xC48BA3), c(0xE0115F), c(0xFFFFFF), c(0xFFE6F0), false,
            p(0xE0115F, 0xFF6F91, 0x9B1B4B, 0xFFA3C0, 0xC2185B, 0xFF4D88, 0x7A0E3A, 0xF8BBD0)),
        AppTheme("emerald", "Изумруд", c(0x04170F), c(0x0B2A1D), c(0xE3FFF2), c(0x87B8A0), c(0x10B981), c(0x04170F), c(0xE3FFF2), false,
            p(0x10B981, 0x047857, 0x34D399, 0x065F46, 0x6EE7B7, 0x059669, 0xA7F3D0, 0x0D9488)),
        AppTheme("amethyst", "Аметист", c(0x150B24), c(0x24163A), c(0xF1E8FF), c(0xA593C4), c(0xA855F7), c(0xFFFFFF), c(0xE9D5FF), false,
            p(0xA855F7, 0x7C3AED, 0xC084FC, 0x6D28D9, 0xD8B4FE, 0x9333EA, 0x581C87, 0xE879F9)),
        AppTheme("sand", "Песок", c(0xF7F1E3), c(0xFFFBF2), c(0x45392A), c(0x958671), c(0xC08A3E), c(0xFFFFFF), c(0x45392A), true,
            p(0xE9C893, 0xC08A3E, 0xF3E0B5, 0xA9744F, 0xD9B77E, 0x8C6A43, 0xEED9A9, 0xB5895A)),
        AppTheme("graphite", "Графит", c(0x1C1F24), c(0x2A2F36), c(0xE6E9EE), c(0x8E96A3), c(0x5B8DEF), c(0xFFFFFF), c(0xC9CED6), false,
            p(0x5B8DEF, 0x48505C, 0x8E96A3, 0x3A414B, 0x7FA8F5, 0x5E6672, 0xB0B7C3, 0x2F6FE0)),
        AppTheme("rainbow", "Радуга", c(0x111827), c(0x1F2937), c(0xF9FAFB), c(0x9CA3AF), c(0xF472B6), c(0x111827), c(0xF9FAFB), false,
            p(0xEF4444, 0xF97316, 0xFACC15, 0x22C55E, 0x06B6D4, 0x3B82F6, 0x8B5CF6, 0xEC4899)),
        AppTheme("lemonade", "Лимонад", c(0xFFFDE7), c(0xFFFFFF), c(0x3A3A1F), c(0x8A8A5C), c(0xF2B705), c(0x3A3A1F), c(0x3A3A1F), true,
            p(0xFFF176, 0xF2B705, 0xC5E1A5, 0xFFD54F, 0xAED581, 0xFFEE58, 0x9CCC65, 0xFFCA28)),
        AppTheme("cherry", "Вишня", c(0x1A0508), c(0x2E0B11), c(0xFFE9EC), c(0xB98088), c(0xD7263D), c(0xFFFFFF), c(0xFFE9EC), false,
            p(0xD7263D, 0x8E1B2B, 0xFF5A6E, 0x5C0F1A, 0xF29CA3, 0xB51F35, 0x3E0A12, 0xFF8FA0)),
        // «Гроза над полем»: грозовое небо, пшеница, палитра с присланной картинки
        AppTheme("storm", "Гроза", c(0x1A1F29), c(0x262D3A), c(0xF6ECD6), c(0x9C9A9E), c(0xE7A922), c(0x1A1F29), c(0xF6ECD6), false,
            p(0xE7A922, 0x123D4E, 0xF38001, 0x4F4E56, 0xDA851B, 0x796F70, 0xF2C14E, 0x2E5A73)),
        // зелёный терминал: моноширинный шрифт, контуры, квадратные кнопки
        AppTheme("terminal", "Терминал", c(0x020A04), c(0x0A1A0E), c(0x39FF7A), c(0x1F9A4A), c(0x39FF7A), c(0x020A04), c(0x39FF7A), false,
            p(0x39FF7A, 0x1FD15E, 0x9BFFB8, 0x12A847, 0x63FF97, 0x0E8A3A)),
        // комикс: светлый фон, жирные чёрные обводки, яркие основные цвета
        AppTheme("comic", "Комикс", c(0xFFF8DC), c(0xFFFFFF), c(0x111111), c(0x555555), c(0xFF3B30), c(0xFFFFFF), c(0x111111), true,
            p(0xFF3B30, 0xFFD60A, 0x0A84FF, 0x34C759, 0xFF9F0A, 0xBF5AF2)),
        // «Осенний лес»: фото присланного леса на фоне, палитра — с той же картинки (тёмные сине-серые, бурые, ржавая листва)
        AppTheme("autumn", "Осенний лес", c(0x15141C), c(0x243142), c(0xF0E6DA), c(0x8F96A3), c(0xD98A3A), c(0x15141C), c(0xE8D9C4), false,
            p(0xC8782F, 0x414A59, 0x735442, 0x273445, 0xE0A04A, 0x463838, 0xA05E38, 0x5C6B80)),
        // бумага: тетрадный лист, засечки, тонкие цветные контуры
        AppTheme("paper", "Бумага", c(0xFAF7F0), c(0xFFFFFF), c(0x2B2B2B), c(0x8A8578), c(0x2B59C3), c(0xFFFFFF), c(0x2B2B2B), true,
            p(0x2B59C3, 0xC8323C, 0x2E8B57, 0xD98E04, 0x6A4C93, 0x1B998B)),
    )

    /** Стиль каждой темы: шрифт, кнопки, сектора, фон, обод. */
    private fun style(t: AppTheme): AppTheme = when (t.id) {
        "day" -> t.copy(corners = 24, backdrop = Backdrop.GRADIENT, rimWidth = 3f)
        "neon" -> t.copy(font = Font.MONO, corners = 0, sectors = Sectors.OUTLINE, backdrop = Backdrop.GRADIENT, rimWidth = 2f)
        "ocean" -> t.copy(sectors = Sectors.GRADIENT, backdrop = Backdrop.GRADIENT, corners = 20)
        "sunset" -> t.copy(font = Font.CONDENSED, sectors = Sectors.GRADIENT, backdrop = Backdrop.GRADIENT, corners = 10)
        "pastel" -> t.copy(corners = 30, sectors = Sectors.GRADIENT, backdrop = Backdrop.DOTS, rimWidth = 8f)
        "forest" -> t.copy(font = Font.SERIF, corners = 6, backdrop = Backdrop.DOTS)
        "mono" -> t.copy(font = Font.MONO, corners = 0, sectors = Sectors.OUTLINE, rimWidth = 2f)
        "sakura" -> t.copy(font = Font.SERIF, corners = 30, backdrop = Backdrop.DOTS, rimWidth = 4f)
        "space" -> t.copy(font = Font.CONDENSED, sectors = Sectors.GRADIENT, backdrop = Backdrop.STARS, corners = 22)
        "cyber" -> t.copy(font = Font.MONO, corners = 0, sectors = Sectors.OUTLINE, backdrop = Backdrop.DOTS, rimWidth = 3f)
        "mint" -> t.copy(corners = 26, rimWidth = 3f, backdrop = Backdrop.GRADIENT)
        "coffee" -> t.copy(font = Font.SERIF, corners = 8, sectors = Sectors.GRADIENT, backdrop = Backdrop.GRADIENT)
        "lava" -> t.copy(font = Font.CONDENSED, corners = 4, sectors = Sectors.GRADIENT, backdrop = Backdrop.GRADIENT, rimWidth = 7f)
        "arctic" -> t.copy(font = Font.CONDENSED, corners = 18, backdrop = Backdrop.GRADIENT, rimWidth = 3f)
        "gold" -> t.copy(font = Font.SERIF, corners = 2, sectors = Sectors.GRADIENT, rimWidth = 6f)
        "retro" -> t.copy(font = Font.SERIF, corners = 4, backdrop = Backdrop.DOTS, rimWidth = 9f)
        "raspberry" -> t.copy(corners = 30, sectors = Sectors.GRADIENT)
        "emerald" -> t.copy(font = Font.SERIF, corners = 12, sectors = Sectors.GRADIENT, backdrop = Backdrop.GRADIENT)
        "amethyst" -> t.copy(corners = 24, sectors = Sectors.OUTLINE, backdrop = Backdrop.STARS, rimWidth = 3f)
        "sand" -> t.copy(font = Font.SERIF, corners = 10, backdrop = Backdrop.DOTS)
        "graphite" -> t.copy(font = Font.MONO, corners = 6, rimWidth = 3f)
        "rainbow" -> t.copy(corners = 30, backdrop = Backdrop.GRADIENT, rimWidth = 7f)
        "lemonade" -> t.copy(font = Font.CONDENSED, corners = 30, sectors = Sectors.GRADIENT)
        "cherry" -> t.copy(font = Font.SERIF, corners = 16, sectors = Sectors.GRADIENT, backdrop = Backdrop.GRADIENT)
        "storm" -> t.copy(font = Font.CONDENSED, corners = 8, sectors = Sectors.GRADIENT, backdrop = Backdrop.GRADIENT)
        "terminal" -> t.copy(font = Font.MONO, corners = 0, sectors = Sectors.OUTLINE, backdrop = Backdrop.DOTS, rimWidth = 2f)
        "comic" -> t.copy(font = Font.CONDENSED, corners = 0, rimWidth = 10f, backdrop = Backdrop.DOTS)
        "paper" -> t.copy(font = Font.SERIF, corners = 4, sectors = Sectors.OUTLINE, backdrop = Backdrop.DOTS, rimWidth = 2f)
        "autumn" -> t.copy(font = Font.SERIF, corners = 12, sectors = Sectors.GRADIENT, backdrop = Backdrop.PHOTO,
            rimWidth = 4f, photo = R.drawable.forest)
        else -> t
    }

    val all = base.map(::style)

    fun byId(id: String?) = all.firstOrNull { it.id == id } ?: all[0]
}

/** Фон экрана по теме: однотонный, градиент, точки (сетка) или звёзды. */
class BackdropDrawable(private val t: AppTheme, private val res: android.content.res.Resources) : android.graphics.drawable.Drawable() {
    private val density = res.displayMetrics.density
    private val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)

    override fun draw(canvas: android.graphics.Canvas) {
        val b = bounds
        paint.shader = null
        paint.color = t.bg
        canvas.drawRect(b, paint)
        when (t.backdrop) {
            Backdrop.SOLID -> {}
            Backdrop.GRADIENT -> {
                // сверху — фон, книзу — к цвету панели и акценту
                val bottom = blend(t.panel, t.accent, 0.12f)
                paint.shader = android.graphics.LinearGradient(0f, b.top.toFloat(), 0f, b.bottom.toFloat(),
                    t.bg, bottom, android.graphics.Shader.TileMode.CLAMP)
                canvas.drawRect(b, paint)
                paint.shader = null
            }
            Backdrop.DOTS -> {
                paint.color = (t.muted and 0x00FFFFFF) or 0x30000000
                val step = 22 * density
                var y = b.top + step / 2
                while (y < b.bottom) {
                    var x = b.left + step / 2
                    while (x < b.right) { canvas.drawCircle(x, y, 1.4f * density, paint); x += step }
                    y += step
                }
            }
            Backdrop.PHOTO -> {
                val bmp = photo(res, t.photo) ?: return
                // по центру с обрезкой краёв, как centerCrop
                val k = maxOf(b.width() / bmp.width.toFloat(), b.height() / bmp.height.toFloat())
                val w = bmp.width * k; val h = bmp.height * k
                val dst = android.graphics.RectF(b.exactCenterX() - w / 2, b.exactCenterY() - h / 2, b.exactCenterX() + w / 2, b.exactCenterY() + h / 2)
                paint.isFilterBitmap = true
                canvas.drawBitmap(bmp, null, dst, paint)
                // затемнение, чтобы колесо и текст читались: сверху легче, книзу плотнее
                val base = t.bg and 0x00FFFFFF
                paint.shader = android.graphics.LinearGradient(0f, b.top.toFloat(), 0f, b.bottom.toFloat(),
                    intArrayOf(base or 0x8C000000.toInt(), base or 0xB0000000.toInt(), base or 0xE6000000.toInt()),
                    floatArrayOf(0f, 0.45f, 1f), android.graphics.Shader.TileMode.CLAMP)
                canvas.drawRect(b, paint)
                paint.shader = null
            }
            Backdrop.STARS -> {
                val rnd = java.util.Random(37)
                repeat(140) {
                    val x = b.left + rnd.nextFloat() * b.width()
                    val y = b.top + rnd.nextFloat() * b.height()
                    val a = 60 + rnd.nextInt(170)
                    paint.color = (t.text and 0x00FFFFFF) or (a shl 24)
                    canvas.drawCircle(x, y, (0.6f + rnd.nextFloat() * 1.4f) * density, paint)
                }
            }
        }
    }

    companion object {
        private val cache = HashMap<Int, android.graphics.Bitmap>()
        /** Фото фона, уменьшенное до разумного размера; загружается один раз. */
        fun photo(res: android.content.res.Resources, id: Int): android.graphics.Bitmap? {
            if (id == 0) return null
            return cache.getOrPut(id) { android.graphics.BitmapFactory.decodeResource(res, id) ?: return null }
        }
    }

    private fun blend(a: Int, b: Int, f: Float): Int {
        fun ch(s: Int) = (((a shr s) and 0xFF) * (1 - f) + ((b shr s) and 0xFF) * f).toInt() shl s
        return (0xFF shl 24) or ch(16) or ch(8) or ch(0)
    }

    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(cf: android.graphics.ColorFilter?) {}
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = android.graphics.PixelFormat.OPAQUE
}
