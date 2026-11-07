// Vite móvil sustituye únicamente el proveedor nativo; nunca incluye Electron/Node.
export function crearPlataformaEscritorio(): never {
  throw new Error('Archivos y diálogos de escritorio no disponibles aún en Android');
}
