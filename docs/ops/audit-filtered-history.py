#!/usr/bin/env python3
"""Count refs, identities and sensitive filenames without exposing values."""
import json
import argparse
from pathlib import Path
import re
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('repo', type=Path)
parser.add_argument('--allow-relay-branches', action='store_true')
args = parser.parse_args()
repo = str(args.repo.resolve())
def git(*args):
    return subprocess.check_output(['git', '-C', repo, *args], text=True)
refs = git('for-each-ref', '--format=%(refname)').splitlines()
emails = git('log', '--all', '--format=%ae%n%ce').splitlines()
identity_names = git('log', '--all', '--format=%an%n%cn').splitlines()
taggers = git('for-each-ref', '--format=%(taggeremail)', 'refs/tags').splitlines()
tagger_names = git('for-each-ref', '--format=%(taggername)', 'refs/tags').splitlines()
names = git('log', '--all', '--diff-filter=A', '--name-only', '--format=').splitlines()
literal = [x for x in names if re.search(r'\.(sql\.gz|dump|pem|key|env)', x)]
actual = [x for x in names if re.search(r'\.(sql\.gz|dump|pem|key)$|(^|/)\.env(?:\.|$)', x)
          and not x.endswith('.example')]
summary = {'branches': sum(x.startswith('refs/heads/') for x in refs),
           'tags': sum(x.startswith('refs/tags/') for x in refs),
           'other_refs': sum(not x.startswith(('refs/heads/', 'refs/tags/')) for x in refs),
           'noncanonical_identities': sum(x != 'Garblesnarff@users.noreply.github.com' for x in emails),
           'noncanonical_identity_names': sum(x != 'Garblesnarff' for x in identity_names),
           'noncanonical_taggers': sum(x.strip('<>') != 'Garblesnarff@users.noreply.github.com' for x in taggers if x),
           'noncanonical_tagger_names': sum(x != 'Garblesnarff' for x in tagger_names if x),
           'literal_filename_matches': len(literal),
           'exact_env_example_matches': sum(x.endswith('.env.example') for x in literal),
           'actual_secret_file_matches': len(actual),
           'commits': len(git('rev-list', '--all').splitlines())}
print(json.dumps(summary))
print(git('count-objects', '-vH'), end='')
sys.exit(1 if actual or summary['noncanonical_identities'] or (any(not re.fullmatch(r'refs/heads/(main|relay-cutover-pr-[0-9]+)', x) for x in refs if x.startswith('refs/heads/')) if args.allow_relay_branches else summary['branches'] != 1)
         or summary['noncanonical_identity_names'] or summary['noncanonical_taggers'] or summary['noncanonical_tagger_names']
         or summary['other_refs'] else 0)
