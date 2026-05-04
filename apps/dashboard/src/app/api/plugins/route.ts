import { NextResponse } from 'next/server';
import { PluginManager } from '@claw/core/lib/plugin-manager';

/**
 * GET /api/plugins
 * Returns a list of all registered plugins and their UI extensions.
 */
export async function GET() {
  try {
    const plugins = PluginManager.getAllPlugins();

    // Filter to only include serializable UI metadata
    const manifest = plugins.map((p) => ({
      id: p.id,
      sidebarExtensions: p.sidebarExtensions || [],
      layoutExtensions: p.layoutExtensions || [],
    }));

    return NextResponse.json({
      success: true,
      plugins: manifest,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load plugins',
      },
      { status: 500 }
    );
  }
}
