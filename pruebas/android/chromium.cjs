const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const ventana = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  try {
    await ventana.loadURL(`${process.argv[2]}/pruebas/android/persistencia.html`);
    const persistencia = await ventana.webContents.executeJavaScript('window.pruebaTerminada');
    await ventana.loadURL(`${process.argv[2]}/index.html`);
    const pantallas = [];
    for (const ancho of [360, 800]) {
      ventana.setContentSize(ancho, 900);
      pantallas.push(await ventana.webContents.executeJavaScript(`(async () => {
        const esperar = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 100 && !document.querySelector('.app'); i++) await esperar(100);
        if (!document.querySelector('.app')) throw new Error(document.body.textContent);
        const boton = document.querySelector('.menu-movil');
        const plegable = getComputedStyle(boton).display !== 'none';
        if (plegable) boton.click();
        await esperar(50);
        const abierto = getComputedStyle(document.querySelector('.lateral')).display !== 'none';
        document.querySelectorAll('nav button')[9].click();
        await esperar(300);
        const cerrado = getComputedStyle(document.querySelector('.lateral')).display === 'none';
        const tabla = document.createElement('table');
        tabla.innerHTML = '<tbody><tr>' + '<td>AND3_columna_sintetica_larga</td>'.repeat(20) + '</tr></tbody>';
        document.querySelector('.contenido').append(tabla);
        const resultado = { ancho: innerWidth, plegable, abierto, cerrado,
          pagina: document.documentElement.scrollWidth <= innerWidth,
          scrollTabla: tabla.scrollWidth > tabla.clientWidth && getComputedStyle(tabla).overflowX === 'auto' };
        tabla.remove();
        return resultado;
      })()`));
    }
    console.log('AND3_JSON=' + JSON.stringify({ persistencia, pantallas }));
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
});
setTimeout(() => { console.error('Timeout AND3'); app.exit(2); }, 60000).unref();
