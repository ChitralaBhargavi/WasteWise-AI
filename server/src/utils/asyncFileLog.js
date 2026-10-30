import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDirectory = fileURLToPath(new URL('../../', import.meta.url))
const logFilePath = join(serverDirectory, 'logs', 'requests.log')

export async function appendRequestLog(entry) {
  await mkdir(dirname(logFilePath), { recursive: true })
  await appendFile(logFilePath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, 'utf8')
}
