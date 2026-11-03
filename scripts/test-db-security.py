#!/usr/bin/env python3
"""Run migrations and security tests in a disposable, socket-only PostgreSQL.

Never connects to Supabase or any existing database. Requires local PostgreSQL
binaries (PG_BIN can select their directory); no Docker or Python packages.
"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def postgres_bin():
    candidates = [os.environ.get('PG_BIN')]
    if shutil.which('pg_config'):
        candidates.append(subprocess.check_output(
            ['pg_config', '--bindir'], text=True).strip())
    if shutil.which('initdb'):
        candidates.append(str(Path(shutil.which('initdb')).parent))
    candidates.extend([
        '/opt/homebrew/opt/postgresql@17/bin',
        '/opt/homebrew/opt/postgresql@16/bin',
    ])
    for candidate in candidates:
        if candidate and all((Path(candidate) / command).is_file()
                             for command in ['initdb', 'pg_ctl', 'psql']):
            return Path(candidate)
    raise SystemExit('PostgreSQL binaries unavailable: set PG_BIN. Tests NOT run.')


def main():
    binaries = postgres_bin()
    env = os.environ.copy()
    # Ignore inherited connection settings; all connections use our own socket.
    for name in list(env):
        if name.startswith('PG'):
            del env[name]

    def run(command, **kwargs):
        return subprocess.run(command, env=env, check=True, text=True, **kwargs)

    # Use /tmp to stay below PostgreSQL's Unix socket path-length limit on macOS.
    with tempfile.TemporaryDirectory(prefix='milekeeper-db-test-', dir='/tmp') as tmp:
        data = Path(tmp) / 'data'
        run([str(binaries / 'initdb'), '-D', str(data), '-U', 'postgres',
             '-A', 'trust', '--no-locale', '--encoding=UTF8'],
            stdout=subprocess.DEVNULL)
        started = False
        try:
            run([str(binaries / 'pg_ctl'), '-D', str(data), '-l', f'{tmp}/postgres.log',
                 '-o', f"-F -k {tmp} -c listen_addresses=''", '-w', 'start'],
                stdout=subprocess.DEVNULL)
            started = True
            psql = [str(binaries / 'psql'), '-X', '-h', tmp, '-U', 'postgres',
                    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
            run(psql + ['-c', 'SELECT version();'])
            run(psql + ['-f', str(ROOT / 'supabase/tests/fixtures/security_bootstrap.sql')],
                stdout=subprocess.DEVNULL)
            migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
            # Apply the historical schema, then install representative existing
            # records before each stage's migrations. No production data.
            stage1_names = {'restrict_keep_alive_access', 'enforce_service_event_owner'}
            stage2_names = {'add_service_event_kind'}
            def stage(names):
                return [m for m in migrations if any(name in m.stem for name in names)]
            stage1, stage2 = stage(stage1_names), stage(stage2_names)
            if len(stage1) != 2 or len(stage2) != 1:
                raise SystemExit('Expected two stage-1 migrations and one stage-2 migration.')
            old = [m for m in migrations if m not in stage1 and m not in stage2]
            if any(m.name > stage1[0].name for m in old):
                raise SystemExit('Unexpected migration after stage 1; register it with a test stage.')
            new = stage1
            for migration in old:
                run(psql + ['-f', str(migration)], stdout=subprocess.DEVNULL)
            run(psql + ['-f', str(ROOT / 'supabase/tests/fixtures/security_existing_data.sql')],
                stdout=subprocess.DEVNULL)
            for migration in stage1:
                print(f'Applying {migration.name}', flush=True)
                run(psql + ['-f', str(migration)], stdout=subprocess.DEVNULL)
            # Stage 2: more existing rows (a separate user), fingerprint, migrate.
            run(psql + ['-f', str(ROOT / 'supabase/tests/fixtures/service_event_kinds_existing_data.sql')],
                stdout=subprocess.DEVNULL)
            for migration in stage2:
                print(f'Applying {migration.name}', flush=True)
                run(psql + ['-f', str(migration)], stdout=subprocess.DEVNULL)
            # Stage-1 guarantees must still hold on the stage-2 schema.
            run(psql + ['-f', str(ROOT / 'supabase/tests/database_security.sql')])
            run(psql + ['-f', str(ROOT / 'supabase/tests/service_event_kinds.sql')])

            # Re-applying the stage-2 migration fails as a whole and changes nothing.
            constraints = psql + ['-At', '-c', "SELECT string_agg(conname, ',' ORDER BY conname) "
                                  "FROM pg_constraint WHERE conrelid = 'public.service_events'::regclass;"]
            before = run(constraints, capture_output=True).stdout
            repeated = subprocess.run(psql + ['-f', str(stage2[0])], env=env, text=True, capture_output=True)
            if repeated.returncode == 0 or 'already exists' not in repeated.stderr:
                raise SystemExit('Expected a repeated stage-2 migration to fail.')
            if run(constraints, capture_output=True).stdout != before:
                raise SystemExit('A failed stage-2 migration must not leave partial changes.')
            print('PASS: repeated stage-2 migration fails atomically', flush=True)

            # A second isolated database verifies failure/rollback when historical
            # data violate the new FK. No automated repair or deletion is allowed.
            run(psql + ['-c', 'CREATE DATABASE legacy_mismatch;'], stdout=subprocess.DEVNULL)
            mismatch_psql = psql.copy()
            mismatch_psql[mismatch_psql.index('-d') + 1] = 'legacy_mismatch'
            # Roles already exist cluster-wide; bootstrap schema/grants separately.
            run(mismatch_psql + ['-f', str(ROOT / 'supabase/tests/fixtures/security_bootstrap.sql')],
                stdout=subprocess.DEVNULL)
            for migration in old:
                run(mismatch_psql + ['-f', str(migration)], stdout=subprocess.DEVNULL)
            run(mismatch_psql + ['-f', str(ROOT / 'supabase/tests/fixtures/security_existing_data.sql')],
                stdout=subprocess.DEVNULL)
            run(mismatch_psql + ['-c', "UPDATE public.service_events SET user_id = "
                                "'00000000-0000-0000-0000-000000000002';"],
                stdout=subprocess.DEVNULL)
            owner_migration = next(m for m in new if 'enforce_service_event_owner' in m.stem)
            failed = subprocess.run(mismatch_psql + ['-f', str(owner_migration)],
                                    env=env, text=True, capture_output=True)
            if failed.returncode == 0 or 'service_events_owner_item_fkey' not in failed.stderr:
                raise SystemExit('Expected FK validation to reject legacy mismatch.')
            run(mismatch_psql + ['-f', str(ROOT / 'supabase/tests/legacy_mismatch_rollback.sql')])
            print('Database security tests PASSED. Temporary databases will be removed.')
        finally:
            if started:
                run([str(binaries / 'pg_ctl'), '-D', str(data), '-m', 'immediate',
                     '-w', 'stop'], stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
