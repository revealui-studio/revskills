#!/usr/bin/env python3
"""Install native continuity skills and their committed helper closure.

This is an explicit install surface alongside Agent Skills installers. It never
replaces an owner skill or an unowned command. Dirty source remains untouched.
"""
import argparse
import io
import json
from pathlib import Path
import shlex
import subprocess
import tarfile
import tempfile

SKILLS = ['revealui-checkpoint', 'revealui-coordinate', 'revealui-rollup']
MARKER = '# generated-by-revskills-native'


def git(source, *args):
    return subprocess.check_output(['git', '-C', str(source), *args], stderr=subprocess.PIPE)


def install(source, home, fleet, apply=False):
    source, home, fleet = Path(source).resolve(), Path(home).resolve(), Path(fleet).resolve()
    if not (fleet / '.jv').is_dir() or not (fleet / 'revealui').is_dir():
        raise ValueError('fleet root must contain the canonical planning and product checkouts')
    selected = ['scripts', *['skills/' + name for name in SKILLS]]
    if git(source, 'status', '--porcelain=v1', '--', *selected).strip():
        raise ValueError('selected source has uncommitted changes; commit before installing')
    revision = git(source, 'rev-parse', 'HEAD').decode().strip()
    store = home / '.local/share/revealui/skills'
    release = store / revision
    bins = home / '.local/bin'
    config = home / '.config/revkit/skills-env.sh'
    skills = home / '.agents/skills'
    commands = {
        'revealui-coordinate': '#!/bin/bash\n' + MARKER + '\n. ' + shlex.quote(str(config)) + '\nexec node ' + shlex.quote(str(release / 'skills/revealui-coordinate/scripts/coordinate.js')) + ' "$@"\n',
        'revealui-session-state': '#!/bin/sh\n' + MARKER + '\n[ "$#" -eq 0 ] || exit 2\nprintf \'%s\\n\' ' + shlex.quote(str(config)) + '\n',
    }
    env = MARKER + '\nexport REVEALFLEET_ROOT=' + shlex.quote(str(fleet)) + '\nexport REVSKILLS_ROOT=' + shlex.quote(str(release)) + '\n. "$REVSKILLS_ROOT/scripts/lib/session-state.sh"\n'
    # Refuse every collision before publishing or editing the first consumer.
    for target in [config, *[bins / name for name in commands]]:
        if target.is_symlink() or (target.exists() and MARKER not in target.read_text().splitlines()[:3]):
            raise ValueError(f'owner configuration preserved; unowned destination: {target}')
        temporary = target.with_name(target.name + '.native-new')
        if temporary.exists() or temporary.is_symlink():
            raise ValueError(f'native staging destination already exists: {temporary}')
    for name in SKILLS:
        target = skills / name
        temporary = target.with_name(name + '.native-new')
        if temporary.exists() or temporary.is_symlink():
            raise ValueError(f'native skill staging destination already exists: {temporary}')
        if target.is_symlink():
            old = target.resolve()
            if not old.is_relative_to(store) or not (old.parents[1] / '.native-install.json').is_file():
                raise ValueError(f'owner skill link preserved: {target}')
        elif target.exists():
            raise ValueError(f'owner skill preserved: {target}')
    if release.exists():
        manifest = release / '.native-install.json'
        if release.is_symlink() or not manifest.is_file() or json.loads(manifest.read_text()).get('revision') != revision:
            raise ValueError('unowned release destination')
    result = {'schema': 1, 'revision': revision, 'release': str(release), 'skills': SKILLS, 'applied': apply}
    if not apply:
        return result
    store.mkdir(parents=True, exist_ok=True)
    if not release.exists():
        payload = git(source, 'archive', '--format=tar', 'HEAD', *selected)
        with tempfile.TemporaryDirectory(prefix='.native-stage-', dir=store) as temporary:
            staging = Path(temporary) / 'release'
            staging.mkdir()
            with tarfile.open(fileobj=io.BytesIO(payload), mode='r:') as archive:
                archive.extractall(staging, filter='data')
            for required in ['scripts/lib/session-state.sh', 'scripts/lib/snapshot-files.mts', 'skills/revealui-coordinate/scripts/coordinate.js']:
                if not (staging / required).is_file():
                    raise ValueError(f'incomplete committed helper closure: {required}')
            (staging / '.native-install.json').write_text(json.dumps(result, indent=2) + '\n')
            staging.rename(release)
    config.parent.mkdir(parents=True, exist_ok=True)
    bins.mkdir(parents=True, exist_ok=True)
    skills.mkdir(parents=True, exist_ok=True)
    for target, text, mode in [(config, env, 0o600), *[(bins / name, body, 0o755) for name, body in commands.items()]]:
        temporary = target.with_name(target.name + '.native-new')
        if temporary.exists() or temporary.is_symlink():
            raise ValueError('native installer staging collision')
        temporary.write_text(text)
        temporary.chmod(mode)
        temporary.replace(target)
    for name in SKILLS:
        target = skills / name
        temporary = target.with_name(name + '.native-new')
        if temporary.exists() or temporary.is_symlink():
            raise ValueError('native skill staging collision')
        temporary.symlink_to(release / 'skills' / name, target_is_directory=True)
        temporary.replace(target)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fleet-root', required=True)
    parser.add_argument('--home', default=str(Path.home()))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        result = install(Path(__file__).resolve().parents[1], args.home, args.fleet_root, args.apply)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, f'native skill install refused: {error}\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
