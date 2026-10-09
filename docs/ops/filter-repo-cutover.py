#!/usr/bin/env python3
"""Filter a fresh, disposable source mirror; never run against a shared checkout."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

EXCLUDED = ['docs/ci-self-hosted-runner.md', 'GOALS.md', 'backups/', 'prompts/', 'infinite-realms/',
            'ai-adventure-scribe-main/server/.env.test', '.beads/',
            'ai-adventure-scribe-main/.beads/', '.factory/',
            'ai-adventure-scribe-main/.jules/', 'ai-adventure-scribe-main/docs/archive/',
            'DEPLOYMENT_SUMMARY.md', 'MONITORING_AND_BACKUPS.md',
            'ai-adventure-scribe-main/docs/UNIT_15_DOCUMENTATION_COMPLETION_REPORT.md']
CALLBACK = r'''
if filename in (b"ai-adventure-scribe-main/docs/MIGRATION_GUIDE.md", b"ai-adventure-scribe-main/docs/SESSION_ARCHIVAL.md", b"ai-adventure-scribe-main/supabase/migrations/README_SESSION_ARCHIVAL.md"):
    import re
    contents = value.get_contents_by_identifier(blob_id)
    contents = re.sub(rb'(Authorization:\s*Bearer\s+)[^"\'\r\n]+', rb'\1$SUPABASE_API_KEY', contents)
    blob_id = value.insert_file_with_contents(contents)
return (filename, mode, blob_id)
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mirror', type=Path)
    parser.add_argument('--keep-pr-heads', action='store_true',
                        help='retain temporary cutover-pr-N heads for Phase 2 rebases')
    args = parser.parse_args()
    repo = args.mirror.resolve()
    def git(*words):
        return subprocess.check_output(['git', '-C', str(repo), *words], text=True)
    if git('rev-parse', '--is-bare-repository').strip() != 'true':
        parser.error('a fresh bare mirror is required')
    source_sha = git('rev-parse', 'main').strip()
    identities = set(git('log', '--all', '--format=%ae%n%ce').splitlines())
    paths = EXCLUDED.copy()
    retained = []
    for folder in ['discord-mcp', 'dnd-5e-mcp-server']:
        result = subprocess.run(['git', '-C', str(repo), 'grep', '-I', '-l', folder,
                                 'main', '--', '*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs',
                                 '*.py', '*.sh', '*.json', '*.yml', '*.yaml',
                                 ':!' + folder, ':!infinite-realms', ':!backups', ':!prompts'],
                                capture_output=True, text=True)
        if result.returncode not in (0, 1):
            raise RuntimeError('live-reference search failed')
        if result.returncode == 0:
            retained.append(folder)
        else:
            paths.append(folder + '/')
    with tempfile.TemporaryDirectory(prefix='repo-cutover-filter-') as directory:
        mailmap = Path(directory) / 'mailmap'
        mailmap.write_text(''.join('Garblesnarff <Garblesnarff@users.noreply.github.com> <' + a + '>\n'
                                  for a in sorted(identities) if a))
        mailmap.chmod(0o600)
        command = ['git', '-C', str(repo), 'filter-repo', '--invert-paths', '--mailmap', str(mailmap),
                   '--file-info-callback', CALLBACK]
        for path in paths:
            command += ['--path', path]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('filter-repo failed; inspect locally without printing identities')
    refs = git('for-each-ref', '--format=%(refname)').splitlines()
    for ref in refs:
        if ref != 'refs/heads/main' and not ref.startswith('refs/tags/') and not (
                args.keep_pr_heads and re.fullmatch(r'refs/heads/cutover-pr-[0-9]+', ref)):
            subprocess.run(['git', '-C', str(repo), 'update-ref', '-d', ref], check=True)
    subprocess.run(['git', '-C', str(repo), 'reflog', 'expire', '--expire=now', '--all'], check=True,
                   capture_output=True)
    subprocess.run(['git', '-C', str(repo), 'gc', '--prune=now'], check=True, capture_output=True)
    print(json.dumps({'source_sha': source_sha, 'filtered_sha': git('rev-parse', 'main').strip(),
                      'excluded_paths': len(paths), 'retained_mcp_folders': retained,
                      'identity_mappings': len(identities)}))


if __name__ == '__main__':
    main()
