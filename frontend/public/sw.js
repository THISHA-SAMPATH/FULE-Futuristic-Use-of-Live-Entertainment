self.addEventListener('push', (event) => {
  let message = { title: 'FULE safety check-in', body: 'Are you OK? Please check in.', url: '/' };
  try { if (event.data) message = { ...message, ...event.data.json() }; } catch { /* Keep generic notification content. */ }
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    tag: 'fule-safe-walk-checkin',
    renotify: true,
    data: { url: message.url || '/' },
    icon: '/favicon.ico',
    badge: '/favicon.ico'
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { existing.focus(); return existing.navigate(target); }
    return self.clients.openWindow(target);
  }));
});
