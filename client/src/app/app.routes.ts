import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home.page').then((m) => m.HomePage), title: 'PORTAL X — חדר בריחה קולנועי' },
  { path: 'join/:code', loadComponent: () => import('./pages/join.page').then((m) => m.JoinPage), title: 'הצטרפות לחדר — PORTAL X' },
  { path: 'room/:code', loadComponent: () => import('./pages/room.page').then((m) => m.RoomPage), title: 'PORTAL X — הפורטל האחרון' },
  { path: 'gallery', loadComponent: () => import('./pages/gallery.page').then((m) => m.GalleryPage), title: 'תצוגת עיצוב — PORTAL X' },
  { path: 'info/:topic', loadComponent: () => import('./pages/info.page').then((m) => m.InfoPage), title: 'מידע — PORTAL X' },
  { path: '**', redirectTo: '' },
];
