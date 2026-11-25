import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_install', ROOT / 'scripts/install-native.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class NativeInstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.home = self.root / 'home'
        self.fleet = self.root / 'revealfleet'
        for directory in [self.source, self.home, self.fleet / '.jv', self.fleet / 'revealui']:
            directory.mkdir(parents=True, exist_ok=True)
        for name in installer.SKILLS:
            directory = self.source / 'skills' / name
            directory.mkdir(parents=True)
            (directory / 'SKILL.md').write_text('fixture skill\n')
        helpers = self.source / 'scripts/lib'
        helpers.mkdir(parents=True)
        (helpers / 'session-state.sh').write_text('JV_REPO="$REVEALFLEET_ROOT/.jv"\n')
        (helpers / 'snapshot-files.mts').write_text('// fixture\n')
        coordinate = self.source / 'skills/revealui-coordinate/scripts'
        coordinate.mkdir()
        (coordinate / 'coordinate.js').write_text('console.log(process.env.REVEALFLEET_ROOT);\n')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.source), *args], stderr=subprocess.PIPE)

    def test_committed_closure_installs_and_is_independent_of_source_checkout(self):
        result = installer.install(self.source, self.home, self.fleet, True)
        self.assertEqual(result, installer.install(self.source, self.home, self.fleet, True))
        self.source.rename(self.source.with_name('source-retained'))
        helper = self.home / '.local/bin/revealui-coordinate'
        process = subprocess.run([str(helper)], capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stdout.strip(), str(self.fleet))
        self.assertTrue((self.home / '.agents/skills/revealui-checkpoint/SKILL.md').is_file())

    def test_owner_skill_prevents_any_consumer_mutation(self):
        skill = self.home / '.agents/skills/revealui-checkpoint'
        skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_text('owner content')
        with self.assertRaises(ValueError):
            installer.install(self.source, self.home, self.fleet, True)
        self.assertEqual((skill / 'SKILL.md').read_text(), 'owner content')
        self.assertFalse((self.home / '.local/bin/revealui-coordinate').exists())

    def test_dirty_source_is_preserved_and_refused(self):
        source = self.source / 'scripts/lib/session-state.sh'
        source.write_text('owner work in progress\n')
        with self.assertRaises(ValueError):
            installer.install(self.source, self.home, self.fleet, True)
        self.assertEqual(source.read_text(), 'owner work in progress\n')

    def test_plan_does_not_create_any_home_file(self):
        result = installer.install(self.source, self.home, self.fleet)
        self.assertFalse(result['applied'])
        self.assertEqual(list(self.home.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
