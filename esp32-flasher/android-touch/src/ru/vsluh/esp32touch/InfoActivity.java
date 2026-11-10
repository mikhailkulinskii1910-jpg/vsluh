package ru.vsluh.esp32touch;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Короткая подсказка: что это за дополнение и как его включить. */
public class InfoActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        TextView t = new TextView(this);
        t.setTextSize(17);
        t.setText("Дополнение к ESP32 Flasher: в режиме «Управление телефоном» повторяет на телефоне нажатия, "
                + "свайпы и кнопки «Назад», «Домой», «Недавние» с экрана платы.\n\n"
                + "Включите его один раз: Спецвозможности → «Установленные приложения» (или «Скачанные службы») → "
                + "«ESP32 Flasher: нажатия».\n\n"
                + "Если переключатель серый (Android 13 и новее): «О приложении» → ⋮ вверху справа → "
                + "«Разрешить ограниченные настройки», затем включите снова.\n\n"
                + "Дополнение выполняет команды только от приложения ESP32 Flasher и только пока управление запущено.");
        root.addView(t);
        Button a11y = new Button(this);
        a11y.setText("Открыть спецвозможности");
        a11y.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
        });
        root.addView(a11y);
        Button app = new Button(this);
        app.setText("О приложении");
        app.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + getPackageName())));
            }
        });
        root.addView(app);
        setContentView(root);
    }
}
