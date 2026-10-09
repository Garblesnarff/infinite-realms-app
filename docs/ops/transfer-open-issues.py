#!/usr/bin/env python3
"""Dry-run by default; transfer open issues oldest first on explicit --execute."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def api(path, payload=None):
    command = ['gh', 'api', path]
    if payload is not None:
        command += ['--method', 'POST', '--input', '-']
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='Garblesnarff/infinite-realms-production')
    parser.add_argument('--destination', default='Garblesnarff/infinite-realms-app')
    parser.add_argument('--numbers', type=int, nargs='+')
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--map-file', type=Path, help='new private durable JSONL mapping; required on execute')
    args = parser.parse_args()
    destination = api('repos/' + args.destination)
    if args.execute and not destination['private']:
        parser.error('destination must be private during issue transfer')
    issues = []
    page = 1
    while True:
        batch = api(f'repos/{args.source}/issues?state=open&per_page=100&page={page}')
        issues.extend(x for x in batch if 'pull_request' not in x)
        if len(batch) < 100:
            break
        page += 1
    excluded = {2093, 2184, 2729} if args.source.endswith('/infinite-realms-production') else set()
    selected = sorted((x for x in issues if x['number'] not in excluded and
                       (args.numbers is None or x['number'] in args.numbers)),
                      key=lambda x: (x['created_at'], x['number']))
    if args.numbers and {x['number'] for x in selected} != set(args.numbers):
        parser.error('requested issue missing, closed, or excluded')
    print(json.dumps({'open_issues': len(issues), 'selected': len(selected),
                      'excluded_control_issues': len([x for x in issues if x['number'] in excluded]),
                      'execute': args.execute}))
    if not args.execute:
        return
    if args.map_file is None:
        parser.error('--execute requires --map-file')
    # Exclusive creation prevents accidental replay after a partial transfer.
    descriptor = os.open(args.map_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    mapping = os.fdopen(descriptor, 'w')
    mutation = '''mutation($issue:ID!,$repo:ID!){transferIssue(input:{issueId:$issue,
      repositoryId:$repo,createLabelsIfMissing:false}){issue{id number url body state}}}'''
    for issue in selected:
        transferred = api('graphql', {'query': mutation,
                                     'variables': {'issue': issue['node_id'], 'repo': destination['node_id']}})
        if transferred.get('errors'):
            raise RuntimeError('transferIssue returned errors; stop and inspect privately')
        moved = transferred['data']['transferIssue']['issue']
        record = {'old_number': issue['number'], 'new_number': moved['number'],
                  'url': moved['url'], 'old_node_id': issue['node_id'], 'new_node_id': moved['id']}
        mapping.write(json.dumps(record) + '\n')
        mapping.flush()
        os.fsync(mapping.fileno())
        # The recoverable mapping is on disk before body PATCH can fail.
        prefix = f"Moved from {args.source.split('/')[-1]}#{issue['number']}.\n\n"
        body = prefix + (issue['body'] or '')
        command = ['gh', 'api', f"repos/{args.destination}/issues/{moved['number']}",
                   '--method', 'PATCH', '--input', '-']
        subprocess.run(command, input=json.dumps({'body': body}), text=True,
                       capture_output=True, check=True)
        verified = api(f"repos/{args.destination}/issues/{moved['number']}")
        if verified['body'] != body or verified['state'] != 'open' or verified['node_id'] != moved['id']:
            raise RuntimeError('transferred issue verification failed')
        print(json.dumps({'old_number': issue['number'], 'new_number': moved['number'],
                          'body_verified': True, 'url': moved['url'], 'old_node_id': issue['node_id'], 'new_node_id': moved['id']}))


if __name__ == '__main__':
    main()
