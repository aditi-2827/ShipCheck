import type { FeedData } from './types';

export const FEED_DATA: FeedData = {
  schemaVersion: 2,
  categories: [
    { slug: 'environment', name: 'Environment' },
    { slug: 'git', name: 'Git' },
    { slug: 'dependencies', name: 'Dependencies' },
    { slug: 'build', name: 'Build' },
    { slug: 'tests', name: 'Tests' },
    { slug: 'docker', name: 'Docker' },
    { slug: 'security', name: 'Security' },
  ],
  stages: ['Discover', 'Config', 'Git', 'Dependencies', 'Tests', 'Build', 'Docker', 'Security', 'Ship'],
  thresholds: {
    ready: 80,
    warning: 60,
  },
  // Per-category influence on the overall ship score (weights sum to 100).
  // Security intentionally outweighs softer signals like outdated dependencies.
  categoryWeights: {
    security: 25,
    build: 25,
    tests: 15,
    dependencies: 10,
    git: 10,
    environment: 10,
    docker: 5,
  },
};
