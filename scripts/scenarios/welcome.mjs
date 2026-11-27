export const description = 'First launch with no folder open: Open Folder and the recent folders, one of them missing';

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

export const recents = [
  { path: '/Users/ada/cs336/assignment1-basics', shortPath: '~/cs336/assignment1-basics', name: 'assignment1-basics', openedAt: daysAgo(0), exists: true },
  { path: '/Users/ada/cs336/assignment2-systems', shortPath: '~/cs336/assignment2-systems', name: 'assignment2-systems', openedAt: daysAgo(1), exists: true },
  { path: '/demo/running-stats', shortPath: '/demo/running-stats', name: 'running-stats', openedAt: daysAgo(4), exists: true },
  { path: '/Volumes/usb/old-homework', shortPath: '/Volumes/usb/old-homework', name: 'old-homework', openedAt: daysAgo(40), exists: false },
];

export const options = { init: { openDir: null, recents }, missing: ['/Volumes/usb/old-homework'], waitFor: '#open-folder' };

export default async function () {}
