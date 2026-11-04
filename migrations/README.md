# Migrazioni
- `001_init.sql`: schema completo; `dedupe_hash` è `UNIQUE` fin dall'inizio.
- `upgrade_legacy_dedupe.sql.example`: **solo** per database preesistenti senza vincolo univoco (backup dei duplicati, DELETE che tiene il più recente, `ALTER TABLE ... ADD UNIQUE`). Non viene eseguito automaticamente: rinominarlo in `002_...sql` se serve.
