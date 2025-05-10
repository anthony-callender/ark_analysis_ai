import { Hero } from '@/components/hero'
import HowItWorks from '@/components/how-it-works'
import OpenSourceSection from '@/components/open-source-section'
import { cn } from '@/utils/cn'
import Link from 'next/link'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Chat With Your Database - Home',
  description: 'AI-powered database analytics and insights',
}

const Section = ({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) => (
  <section className={cn('max-w-[1240px] mx-auto', className)}>
    {children}
  </section>
)

export default async function Index() {
  const session = await getServerSession(authOptions)
  
  return (
    <>
      <main className="mt-12 mx-auto">
        <Section>
          <Hero />
          <div className="flex justify-center mt-8 gap-4">
            <Link
              href="/app"
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-6 py-3 font-medium"
            >
              Go to App
            </Link>
            
            {!session && (
              <Link
                href="/login"
                className="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-md px-6 py-3 font-medium"
              >
                Login
              </Link>
            )}
          </div>
        </Section>
        <Section className='flex items-center justify-center mt-14'>
          <a
            href="https://www.producthunt.com/posts/chat-with-your-database?embed=true&utm_source=badge-featured&utm_medium=badge&utm_souce=badge-chat&#0045;with&#0045;your&#0045;database"
            target="_blank"
          >
            <img
              src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=495442&theme=dark"
              alt="Chat With Your Database - The AI that knows your Postgres database | Product Hunt"
              width={250}
              height={54}
            />
          </a>
        </Section>
        <Section>
          <HowItWorks />
        </Section>
        <OpenSourceSection />
      </main>
    </>
  )
}
