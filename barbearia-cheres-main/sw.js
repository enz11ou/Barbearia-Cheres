// Service worker mínimo do painel do barbeiro.
// Serve só para mostrar notificações de novo agendamento no Android e abrir o painel ao tocar nelas.
// Não intercepta requisições nem guarda nada offline (sem evento "fetch").
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            const panel = list.find(c => new URL(c.url).pathname.startsWith('/admin'));
            return panel ? panel.focus() : self.clients.openWindow('/admin');
        })
    );
});
