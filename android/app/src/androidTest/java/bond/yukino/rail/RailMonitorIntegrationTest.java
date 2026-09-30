package bond.yukino.rail;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Exercises the real native HTTPS query and local persistence on an Android emulator. */
@RunWith(AndroidJUnit4.class)
public class RailMonitorIntegrationTest {
    @Test public void nativeQueryPersistsAndIncompleteEditsDisableMonitoring() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject draft = RailMonitorEngine.defaults().put("date", "").put("intervalMinutes", 0);
        JSONObject disabled = RailMonitorEngine.configure(context, draft);
        assertFalse(disabled.getJSONObject("settings").getBoolean("enabled"));

        SimpleDateFormat date = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        date.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
        JSONObject settings = RailMonitorEngine.defaults()
            .put("date", date.format(new Date(System.currentTimeMillis() + 24 * 60 * 60 * 1000L)))
            .put("train", "G101").put("seat", "二等座").put("enabled", false);
        RailMonitorEngine.configure(context, settings);
        JSONObject result = RailMonitorEngine.check(context, settings, false);
        assertNotNull(result);
        assertEquals(settings.getString("date"), result.getString("date"));
        assertTrue("12306 returned no G101 service for the next day", result.getJSONArray("trains").length() > 0);
        assertEquals("G101", result.getJSONArray("trains").getJSONObject(0).getString("code"));
        JSONObject restored = RailMonitorEngine.snapshot(context);
        assertEquals("G101", restored.getJSONObject("settings").getString("train"));
        assertEquals(result.toString(), restored.getJSONObject("result").toString());
        assertFalse(restored.getBoolean("checking"));
        assertFalse(restored.getJSONObject("settings").getBoolean("enabled"));
    }
}
