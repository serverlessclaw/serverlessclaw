'use client';

import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from './Button';
import Typography from './Typography';
import { logger } from '@claw/core/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex-1 flex items-center justify-center p-10">
          <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-lg p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="p-4 bg-red-500/10 rounded-full">
                <AlertTriangle size={32} className="text-red-500" />
              </div>
            </div>
            <Typography variant="h3" weight="bold" className="text-white mb-2">
              Something went wrong
            </Typography>
            <Typography variant="body" color="muted" className="mb-6">
              {this.state.error?.message || 'An unexpected error occurred'}
            </Typography>
            <Button
              onClick={this.handleReset}
              variant="outline"
              size="sm"
              icon={<RefreshCw size={14} />}
            >
              Try Again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
