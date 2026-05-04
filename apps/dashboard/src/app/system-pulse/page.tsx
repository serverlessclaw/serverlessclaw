import { redirect } from 'next/navigation';

export default function SystemPulseRedirect() {
  redirect('/observability');
  return null;
}
