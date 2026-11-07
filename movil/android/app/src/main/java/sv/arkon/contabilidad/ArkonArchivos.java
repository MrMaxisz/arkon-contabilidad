package sv.arkon.contabilidad;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;

/** SAF: el proveedor (incluido Drive) es quien gestiona el almacenamiento y la red. */
@CapacitorPlugin(name = "ArkonArchivos")
public class ArkonArchivos extends Plugin {
    private static final int TROZO = 1024 * 1024;
    private InputStream entrada;
    private OutputStream salida;
    private Uri salidaUri;
    private boolean ocupado;
    private WebView impresion;

    private JSObject estado(String valor) { JSObject r = new JSObject(); r.put("estado", valor); return r; }
    private synchronized boolean reservar(PluginCall call) {
        if (ocupado) { call.reject("Hay otra operación de archivos en curso"); return false; }
        ocupado = true; return true;
    }
    private synchronized void limpiar() throws Exception {
        try { if (entrada != null) entrada.close(); }
        finally { entrada = null; try { if (salida != null) salida.close(); } finally { salida = null; salidaUri = null; ocupado = false; } }
    }
    @PluginMethod public void guardar(PluginCall call) {
        if (!reservar(call)) return;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/octet-stream"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("nombre", "ARKON.arkon"));
        try { startActivityForResult(call, i, "seleccionGuardar"); }
        catch (Exception e) { ocupado = false; call.reject("No se pudo abrir el selector", e); }
    }
    @PluginMethod public void abrir(PluginCall call) {
        if (!reservar(call)) return;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("*/*");
        try { startActivityForResult(call, i, "seleccionAbrir"); }
        catch (Exception e) { ocupado = false; call.reject("No se pudo abrir el selector", e); }
    }
    private boolean cancelado(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            ocupado = false; call.resolve(estado("cancelado")); return true;
        }
        return false;
    }
    @ActivityCallback private void seleccionGuardar(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (cancelado(call, result)) return;
        try {
            Uri uri = result.getData().getData();
            salidaUri = uri;
            salida = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (salida == null) throw new Exception("Proveedor sin salida");
            call.resolve(estado("listo"));
        } catch (Exception e) { salidaUri = null; ocupado = false; call.reject("No se pudo guardar el archivo", e); }
    }
    @ActivityCallback private void seleccionAbrir(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (cancelado(call, result)) return;
        try {
            entrada = getContext().getContentResolver().openInputStream(result.getData().getData());
            if (entrada == null) throw new Exception("Proveedor sin entrada");
            call.resolve(estado("listo"));
        } catch (Exception e) { ocupado = false; call.reject("No se pudo leer el archivo", e); }
    }
    @PluginMethod public synchronized void escribirTrozo(PluginCall call) {
        try {
            String texto = call.getString("base64", "");
            if (salida == null || texto.length() > ((TROZO + 2) / 3) * 4) throw new Exception("Trozo inválido");
            byte[] bytes = Base64.decode(texto, Base64.NO_WRAP);
            if (bytes.length > TROZO) throw new Exception("Trozo mayor que 1 MB");
            salida.write(bytes); call.resolve();
        } catch (Exception e) { call.reject("Error de escritura", e); }
    }
    @PluginMethod public synchronized void leerTrozo(PluginCall call) {
        try {
            if (entrada == null) throw new Exception("No hay archivo abierto");
            byte[] bytes = new byte[TROZO]; int total = 0, n;
            while (total < TROZO && (n = entrada.read(bytes, total, TROZO - total)) != -1) { if (n == 0) throw new Exception("Lectura sin progreso"); total += n; }
            JSObject r = new JSObject(); r.put("base64", Base64.encodeToString(bytes, 0, total, Base64.NO_WRAP));
            r.put("fin", total < TROZO); call.resolve(r);
        } catch (Exception e) { call.reject("Error de lectura", e); }
    }
    @PluginMethod public synchronized void cerrar(PluginCall call) {
        boolean descartar = call.getBoolean("descartar", false);
        Uri uri = salidaUri;
        try { limpiar(); }
        catch (Exception e) { call.reject("No se pudo cerrar el archivo", e); return; }
        if (descartar && uri != null) {
            try { DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); }
            catch (Exception ignored) { /* el fallo al descartar no oculta el error original de escritura */ }
        }
        call.resolve(estado("completo"));
    }
    @PluginMethod public void imprimir(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (impresion != null) { call.reject("Hay una impresión en curso"); return; }
            WebView vista = new WebView(getContext()); impresion = vista;
            vista.getSettings().setJavaScriptEnabled(false);
            vista.getSettings().setBlockNetworkLoads(true);
            vista.getSettings().setAllowFileAccess(false);
            vista.getSettings().setAllowContentAccess(false);
            vista.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    view.setWebViewClient(new WebViewClient());
                    try {
                        String nombre = call.getString("nombre", "ARKON");
                        PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(nombre);
                        final android.print.PrintJob[] trabajo = new android.print.PrintJob[1];
                        PrintDocumentAdapter retenido = new PrintDocumentAdapter() {
                            @Override public void onStart() { adapter.onStart(); }
                            @Override public void onLayout(PrintAttributes a, PrintAttributes b, android.os.CancellationSignal c, LayoutResultCallback d, Bundle e) { adapter.onLayout(a,b,c,d,e); }
                            @Override public void onWrite(android.print.PageRange[] a, android.os.ParcelFileDescriptor b, android.os.CancellationSignal c, WriteResultCallback d) { adapter.onWrite(a,b,c,d); }
                            @Override public void onFinish() {
                                adapter.onFinish(); view.destroy(); impresion = null;
                                if (trabajo[0] != null && trabajo[0].isFailed()) call.reject("Falló la impresión del sistema");
                                else call.resolve(estado(trabajo[0] != null && trabajo[0].isCancelled() ? "cancelado" : "impresion"));
                            }
                        };
                        PrintManager manager = (PrintManager) getContext().getSystemService(android.content.Context.PRINT_SERVICE);
                        trabajo[0] = manager.print(nombre, retenido, new PrintAttributes.Builder().build());
                    } catch (Exception e) { view.destroy(); impresion = null; call.reject("No se pudo imprimir", e); }
                }
            });
            vista.loadDataWithBaseURL(null, call.getString("html", ""), "text/html", "UTF-8", null);
        });
    }
    @Override protected void handleOnDestroy() {
        try { limpiar(); } catch (Exception ignored) { }
        if (impresion != null) { impresion.destroy(); impresion = null; }
    }
}
