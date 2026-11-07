const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const ventana = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  try {
    await ventana.loadURL(`${process.argv[2]}/pruebas/android/persistencia.html`);
    const persistencia = await ventana.webContents.executeJavaScript('window.pruebaTerminada');
    await ventana.loadURL(`${process.argv[2]}/index.html`);
    const pantallas = [];
    const secciones = [];
    let cabecera = { logoVisible: false, ariaLabel: '', veloCierra: false, mismaFila: false };
    for (const ancho of [360, 800]) {
      ventana.setContentSize(ancho, 900);
      const medido = await ventana.webContents.executeJavaScript(`(async () => {
        const esperar = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 100 && !document.querySelector('.app'); i++) await esperar(100);
        if (!document.querySelector('.app')) throw new Error(document.body.textContent);
        const boton = document.querySelector('.menu-movil');
        const plegable = getComputedStyle(boton).display !== 'none';
        const lateralRect = () => document.querySelector('.lateral').getBoundingClientRect();
        const abiertoRect = () => lateralRect().right > 1;
        const cerradoRect = () => lateralRect().right <= 1;
        const navBoton = nombre => {
          const b = Array.from(document.querySelectorAll('nav button')).find(x => x.textContent.trim() === nombre);
          if (!b) throw new Error('Sin botón de sección: ' + nombre);
          return b;
        };
        const secciones = [];
        let abierto = false, cerrado = false;
        if (plegable) { boton.click(); await esperar(100); abierto = abiertoRect(); }
        else { abierto = abiertoRect() && getComputedStyle(document.querySelector('.lateral')).display !== 'none'; }
        if (plegable) { navBoton('Catálogo').click(); await esperar(100); }
        await esperar(300);
        cerrado = plegable ? cerradoRect() : false;
        const lista = Array.from(document.querySelectorAll('nav button')).map(b => b.textContent.trim());
        for (const nombre of lista) {
          if (plegable) { boton.click(); await esperar(100); }
          navBoton(nombre).click();
          await esperar(500);
          const ancho = innerWidth;
          const pagina = document.documentElement.scrollWidth <= ancho + 1;
          const menuAbierto = document.querySelector('.menu-abierto') ? true : false;
          const fuera = [];
          for (const el of document.querySelectorAll('body *')) {
            if (el.closest('table')) continue;
            const estilo = getComputedStyle(el);
            if (estilo.display === 'none' || estilo.visibility === 'hidden') continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (plegable && !menuAbierto && el.closest('.lateral')) continue;
            if (r.left < -1 || r.right > ancho + 1) fuera.push((el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className)) + ':' + el.tagName + ':' + Math.round(r.left) + '-' + Math.round(r.right));
          }
          const sinFuera = fuera.length === 0;
          const controlesBajos = [];
          for (const c of document.querySelectorAll('button, input:not([type="checkbox"]):not([type="radio"]), select, textarea')) {
            const estilo = getComputedStyle(c);
            if (estilo.display === 'none' || estilo.visibility === 'hidden') continue;
            const r = c.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (c.closest('.lateral') && plegable && !menuAbierto) continue;
            if (r.height < 43.5) controlesBajos.push(c.tagName + ':' + (c.textContent || c.type || c.value || '').trim().slice(0, 30) + ':' + Math.round(r.height));
          }
          secciones.push({ ancho, seccion: nombre, pagina, sinFuera, controles44: controlesBajos.length === 0, fuera, controlesBajos });
        }
        const tabla = document.createElement('table');
        tabla.innerHTML = '<tbody><tr>' + '<td>AND3_columna_sintetica_larga</td>'.repeat(20) + '</tr></tbody>';
        document.querySelector('.contenido').append(tabla);
        const scrollTabla = tabla.scrollWidth > tabla.clientWidth && getComputedStyle(tabla).overflowX === 'auto';
        tabla.remove();
        const pantalla = { ancho: innerWidth, plegable, abierto, cerrado, pagina: document.documentElement.scrollWidth <= innerWidth + 1, scrollTabla };
        let cab = null;
         if (innerWidth === 360) {
           if (getComputedStyle(document.querySelector('.barra-contexto')).display !== 'none') throw new Error('Barra de contexto repetida en teléfono');
          boton.click(); await esperar(100);
          const img = document.querySelector('.cabecera-movil img');
          const rImg = img && img.getBoundingClientRect();
          const logoVisible = !!(img && img.complete && img.naturalWidth > 0 && rImg.width > 0 && rImg.height > 0);
          const ariaLabel = boton.getAttribute('aria-label') || '';
          await esperar(100);
          const velo = document.querySelector('.velo-menu');
          let veloCierra = false;
          if (velo) { velo.click(); await esperar(100); veloCierra = cerradoRect(); }
          boton.click(); await esperar(100);
          navBoton('Contabilidad').click(); await esperar(500);
          const linea = document.querySelector('.fila-linea:not(.cabecera-lineas):not(.totales-lineas)');
          const inputs = linea ? linea.querySelectorAll('input') : [];
          const mismaFila = inputs.length >= 2 && Math.abs(inputs[0].getBoundingClientRect().top - inputs[1].getBoundingClientRect().top) < 2;
          cab = { logoVisible, ariaLabel, veloCierra, mismaFila };
        }
        return { pantalla, secciones, cab };
      })()`);
      pantallas.push(medido.pantalla);
      secciones.push(...medido.secciones);
      if (medido.cab) cabecera = medido.cab;
    }
    console.log('AND3_JSON=' + JSON.stringify({ persistencia, pantallas, secciones, cabecera }));
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
});
setTimeout(() => { console.error('Timeout AND3'); app.exit(2); }, 60000).unref();
