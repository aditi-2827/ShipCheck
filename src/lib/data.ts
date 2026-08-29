import type { FeedData } from './types';

export const FEED_DATA: FeedData = {
  schemaVersion: 1,
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
};
