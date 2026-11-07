package sv.arkon.contabilidad;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(ArkonArchivos.class);
        super.onCreate(state);
    }
}
