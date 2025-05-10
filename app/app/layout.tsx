export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="fixed inset-0 flex w-full h-screen overflow-hidden max-h-screen">{children}</main>
  )
}
