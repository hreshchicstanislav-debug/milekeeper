import { createDemoSnapshot } from '@/lib/demo/snapshot';
import DemoDashboard from './DemoDashboard';

export default function DemoPage() {
  return <DemoDashboard snapshot={createDemoSnapshot()} />;
}
