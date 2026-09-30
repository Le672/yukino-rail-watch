package bond.yukino.rail;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) { registerPlugin(RailMonitorPlugin.class); super.onCreate(state); }
}