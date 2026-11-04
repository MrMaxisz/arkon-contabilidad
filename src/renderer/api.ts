export interface ArkonApi {
  invocar(comando: string, datos?: unknown): Promise<unknown>;
}

export function api(): ArkonApi {
  return (window as unknown as { arkon: ArkonApi }).arkon;
}
