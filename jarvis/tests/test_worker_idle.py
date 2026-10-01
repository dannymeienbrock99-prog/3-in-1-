import sys, time, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from worker_rpc import Worker

class IdleWorkerTests(unittest.TestCase):
    def worker(self):
        worker = Worker(str(Path(__file__).with_name('worker_echo.py')), timeout=4,
                        executable=sys.executable, idle_seconds=.3)
        self.addCleanup(worker.stop)
        return worker

    def test_releases_memory_after_idle_and_restarts_on_demand(self):
        worker = self.worker()
        first = worker.call({'text': 'eins'})
        child = worker.process
        time.sleep(.65)
        self.assertIsNone(worker.process)
        self.assertIsNotNone(child.poll())
        second = worker.call({'text': 'zwei'})
        self.assertNotEqual(first['pid'], second['pid'])
        self.assertEqual(second['text'], 'zwei')

    def test_idle_timer_never_interrupts_an_active_request(self):
        worker = self.worker()
        first = worker.call({})
        time.sleep(.15)
        second = worker.call({'delay': .6, 'text': 'fertig'})
        self.assertEqual(first['pid'], second['pid'])
        self.assertEqual(second['text'], 'fertig')
        self.assertIsNotNone(worker.process)

if __name__ == '__main__':
    unittest.main()
