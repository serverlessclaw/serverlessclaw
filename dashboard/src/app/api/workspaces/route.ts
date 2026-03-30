import { withApiHandler, requireFields } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('WORKSPACE#');
    const workspaces = items.map((item) => ({
      id: item.userId as string,
      name: item.name ?? 'Unnamed',
      ownerId: item.ownerId ?? '',
      members: item.members ?? [],
      createdAt: item.createdAt ?? item.timestamp ?? 0,
    }));
    return Response.json({ workspaces });
  } catch (e) {
    console.error('Error fetching workspaces:', e);
    return Response.json({ workspaces: [] });
  }
}

export const POST = withApiHandler(async (body) => {
  requireFields(body, 'name', 'ownerId');
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const memory = new DynamoMemory();
  const id = `WORKSPACE#${Date.now()}`;
  await memory.saveConfig(id, {
    name: body.name,
    ownerId: body.ownerId,
    members: [{ id: body.ownerId, role: 'owner', channel: 'dashboard' }],
  });
  return { success: true, id };
});
