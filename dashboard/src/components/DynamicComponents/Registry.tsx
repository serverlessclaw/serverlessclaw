'use client';

import React from 'react';
import { DynamicComponent } from '../Chat/types';
import { useExtensions } from '../Providers/ExtensionProvider';
import OperationCard from './OperationCard';
import UICommand from './UICommand';
import StatusFlow from './StatusFlow';
import ResourcePreview from './ResourcePreview';
import CodeDiff from './CodeDiff';
import PlanEditor from './PlanEditor';

interface RegistryProps {
  component: DynamicComponent;
  onAction?: (actionId: string, payload?: unknown) => void;
}

/**
 * Registry of dynamic components that can be rendered in the chat.
 */
export function DynamicComponentRegistry({ component, onAction }: RegistryProps) {
  const { dynamicComponents } = useExtensions();

  // Check for domain-specific extensions first
  const ExtendedComponent = dynamicComponents.get(component.componentType);
  if (ExtendedComponent) {
    return <ExtendedComponent component={component} onAction={onAction} />;
  }

  switch (component.componentType) {
    case 'operation-card':
    case 'action-card':
      return <OperationCard component={component} onAction={onAction} />;

    case 'ui-command':
      return <UICommand component={component} onAction={onAction} />;

    case 'status-flow':
    case 'deployment-stepper':
      return <StatusFlow component={component} onAction={onAction} />;

    case 'resource-preview':
      return <ResourcePreview component={component} onAction={onAction} />;

    case 'code-diff':
    case 'patch-view':
      return <CodeDiff component={component} onAction={onAction} />;

    case 'plan-editor':
    case 'strategy-editor':
      return <PlanEditor component={component} onAction={onAction} />;

    default:
      return (
        <div className="p-4 border border-dashed border-red-500/20 rounded text-[10px] text-red-500/60 italic font-mono uppercase bg-red-500/5">
          UNSUPPORTED DYNAMIC COMPONENT: {component.componentType}
          <div className="mt-1 text-[8px] opacity-40">
            Ensure the component is registered in Registry.tsx
          </div>
        </div>
      );
  }
}
