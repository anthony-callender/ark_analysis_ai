'use server'

export async function getChats() {
  console.log('getChats function now bypasses database and relies on localStorage')
  return { data: [] }
}
