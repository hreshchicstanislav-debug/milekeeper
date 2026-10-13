import { Suspense } from 'react';
import RecoveryClient from './pageClient';

export const dynamic = 'force-dynamic';
export default function RecoveryPage() {
  return <Suspense><RecoveryClient /></Suspense>;
}
