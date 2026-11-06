# POLÍTICAS PROPUESTAS (pendientes de aprobación del contador responsable)

Este documento registra las reglas implementadas o propuestas con su estado. Ninguna cifra del negocio se usó como parámetro.

## Marco contable

- Partida doble, devengo, trazabilidad documental. Marco de trabajo propuesto: **NIIF para las PYMES**, sujeto a confirmar versión y adopción vigentes ante el CVPCPA. No se declara numeración contable obligatoria única en El Salvador.
- La instalación del software no constituye legalización del sistema ni aprobación de libros.

## IVA

- Tasa general de referencia para El Salvador: **13%** (Ley de IVA). La tasa se configura en `configuracion` con fuente y vigencia oficiales cuando se implemente el módulo fiscal; **no está precargada** por decisión del plan.
- Precio con IVA incluido: `base = total/(1+tasa)`; `iva = total − base`. El desglose nunca aumenta el total.
- Precio sin IVA: `iva = base × tasa`, una sola vez.
- Si el proveedor documenta base e IVA, se conservan esos importes; el cálculo de comprobación solo advierte discrepancias.
- Tratamientos gravado/exento/no sujeto distinguibles; no se representan con tasa cero.
- El IVA de compras **no** se clasifica como crédito fiscal automáticamente: mientras no exista inscripción y soporte válido, se lleva al costo o gasto según política.
- El IVA de planificación se muestra separado del IVA registrado en libros.

## Anticipos

- El reconocimiento financiero y el hecho generador fiscal se tratan por separado. Pendiente la política específica con el contador (hito 4).

## Períodos y correcciones

- Asientos contabilizados no se editan ni borran: solo reverso o ajuste trazable con motivo.
- Cierre de período bloquea contabilización; la reapertura exige motivo y queda en bitácora. Una reapertura contable no modifica una declaración presentada.

## Participantes

- Remuneración, reembolso, aporte, préstamo y retiro se registran diferenciados. No se aplica ningún reparto automático.

## Fuentes oficiales previstas

- Ley de IVA (versión con reformas vigentes por comprobar al implementar el módulo fiscal).
- Formularios F-07, F-14, F-11 y sus anexos: versiones y vigencias según Ministerio de Hacienda; los exportadores declararán la versión de formato usada y no se etiquetarán como compatibles sin verificación contra plantilla oficial.
- DTE: solo importación de archivos obtenidos por medios autorizados; un PDF interno nunca se presenta como DTE aceptado.
