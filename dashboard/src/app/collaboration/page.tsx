import { redirect } from 'next/navigation';

export default function CollaborationPage() {
  redirect('/trace?tab=live');
}
