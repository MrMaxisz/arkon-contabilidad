// Criterio ÚNICO compartido de familia de cierre (auditoría 61).
// Asiento con origen cierre, su reverso y cierres anulados: se excluyen del resultado
// ordinario (el cierre traslada resultados a 3201; contarlo duplicaría el resultado).
// Las anulaciones ordinarias NO se excluyen: original anulado + reverso contabilizado netean cero.
// Requiere que la tabla asiento tenga el alias "a" en la consulta que lo use.
export const SQL_FAMILIA_CIERRE_EXCLUIDA = `NOT EXISTS (
                  SELECT 1 FROM asiento o
                  WHERE (o.id = a.id AND o.origen_tipo = 'cierre')
                     OR (o.id = a.reverso_de_id AND o.origen_tipo = 'cierre')
                )`;

export const SQL_FAMILIA_CIERRE_PRESENTA = `EXISTS (
                  SELECT 1 FROM asiento o
                  WHERE (o.id = a.id AND o.origen_tipo = 'cierre')
                     OR (o.id = a.reverso_de_id AND o.origen_tipo = 'cierre')
                )`;
