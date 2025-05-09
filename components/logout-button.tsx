'use client';

import { logoutAction } from '@/app/actions/auth';

export function LogoutButton() {
  return (
    <button
      onClick={() => logoutAction()}
      className="rounded bg-red-500 px-4 py-2 text-white hover:bg-red-600 transition"
    >
      Logout
    </button>
  );
} 