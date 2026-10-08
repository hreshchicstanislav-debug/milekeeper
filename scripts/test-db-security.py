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
            # records before testing the two new migrations. No production data.
            new_names = {'restrict_keep_alive_access', 'enforce_service_event_owner'}
            old = [m for m in migrations if not any(name in m.stem for name in new_names)]
            new = [m for m in migrations if m not in old]
            if len(new) != 2:
                raise SystemExit('Expected the two stage-1 migrations.')
            for migration in old:
                run(psql + ['-f', str(migration)], stdout=subprocess.DEVNULL)
            run(psql + ['-f', str(ROOT / 'supabase/tests/fixtures/security_existing_data.sql')],
                stdout=subprocess.DEVNULL)
            for migration in new:
                print(f'Applying {migration.name}', flush=True)
                run(psql + ['-f', str(migration)], stdout=subprocess.DEVNULL)
            run(psql + ['-f', str(ROOT / 'supabase/tests/database_security.sql')])

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
