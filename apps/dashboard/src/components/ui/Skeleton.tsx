import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'rectangular' | 'circular' | 'text';
  width?: string | number;
  height?: string | number;
}

/**
 * Skeleton component with a "cyber-pulse" animation.
 * Used to represent loading states for components.
 */
const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'rectangular',
  width,
  height,
}) => {
  const baseStyles = 'animate-cyber-pulse bg-foreground/10';

  const variantStyles = {
    rectangular: 'rounded-sm',
    circular: 'rounded-full',
    text: 'rounded h-[1em] mb-[0.5em] last:mb-0',
  }[variant];

  return (
    <div
      className={`${baseStyles} ${variantStyles} ${className}`}
      style={{
        width: width,
        height: height,
      }}
      aria-hidden="true"
    />
  );
};

export default Skeleton;
