/* ==========================================================================
   UniHub V4 — configuração de ambiente
   --------------------------------------------------------------------------
   Estratégia: local-first. O app lê e grava no IndexedDB do aparelho (rápido e
   funciona offline); o Supabase entra depois como camada de sincronização por
   registro (updated_at + tombstones já são gravados pela camada de dados).

   Para sincronizar com Supabase (próxima etapa):
   1. Crie o projeto e rode supabase/schema.sql.
   2. Preencha supabaseUrl e supabaseAnonKey abaixo (somente a anon key!).
   3. Nunca coloque a service_role key no front. A segurança vem da RLS.

   Créditos: UliFran / Ulisystem® · desenvolvido com Claude (Anthropic).
   ========================================================================== */
window.HUB_CONFIG = {
  appName: 'UniHub',
  appVersion: '4.0.0',
  appEdition: 'V4',
  schemaVersion: 2,
  dataMode: 'local', // 'local' | 'sync' (sincronização com Supabase — em breve)
  supabaseUrl: '',
  supabaseAnonKey: '',
  dbName: 'unihub-v4',
  legacyStorageKey: 'hub-silene-v2'
};
