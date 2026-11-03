package ru.maptag.app;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.net.Uri;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Стартовая страница и её файлы должны отдаваться загрузчиком из assets/www (иначе WebView показывает ERR_INVALID_RESPONSE). */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class AssetLoaderTest {
    @Test
    public void startPageAndFilesResolve() throws Exception {
        WebViewAssetLoader l = MainActivity.loader(RuntimeEnvironment.getApplication());
        for (String path : new String[]{"index.html", "js/app.js", "js/game.js", "js/replay.js", "css/app.css", "css/themes.css", "lib/leaflet.js", "lib/fonts/vt323.ttf"}) {
            WebResourceResponse r = l.shouldInterceptRequest(Uri.parse(MainActivity.BASE + path));
            assertNotNull(path, r);
            assertNotNull(path + " data", r.getData());
            assertTrue(path + " empty", r.getData().read() >= 0);
        }
    }
}
