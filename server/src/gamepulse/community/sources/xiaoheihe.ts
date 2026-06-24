import axios from 'axios';
import crypto from 'node:crypto';
import { getRandomUserAgent } from './common.js';

export interface XiaoheiheNewsItem {
  linkid: number;
  title: string;
  description: string;
  modify_at: number;
}

const XHH_DICT = 'JKMNPQRTX1234OABCDFG56789H';

function md5(value: string): Buffer {
  return crypto.createHash('md5').update(value).digest();
}

function convertByte(value: number): number {
  return value & 0x80 ? 0xff & ((value << 1) ^ 0x1b) : value << 1;
}

function c1(value: number): number { return c2(c3(convertByte(value))); }
function c2(value: number): number { return c3(convertByte(value)); }
function c3(value: number): number { return convertByte(value) ^ value; }
function c0(value: number): number { return c1(value) ^ c2(value) ^ c3(value); }

function checksum(data: number[]): number {
  return [
    c0(data[0]) ^ c1(data[1]) ^ c2(data[2]) ^ c3(data[3]),
    c3(data[0]) ^ c0(data[1]) ^ c1(data[2]) ^ c2(data[3]),
    c2(data[0]) ^ c3(data[1]) ^ c0(data[2]) ^ c1(data[3]),
    c1(data[0]) ^ c2(data[1]) ^ c3(data[2]) ^ c0(data[3])
  ].reduce((sum, value) => sum + value, 0) % 100;
}

function signedUrl(url: string, timestamp = Math.trunc(Date.now() / 1000)): string {
  const nonce = md5(Math.random().toString()).toString('hex').toUpperCase();
  const { pathname } = new URL(url);
  const normalizedPath = '/' + pathname.split('/').filter(Boolean).join('/') + '/';
  const nonceHash = md5((nonce + XHH_DICT).replaceAll(/\D/g, '')).toString('hex').toLowerCase();
  const digits = md5(timestamp + 1 + normalizedPath + nonceHash)
    .toString('hex')
    .replaceAll(/\D/g, '')
    .slice(0, 9)
    .padEnd(9, '0');

  let key = '';
  for (let cursor = Number(digits), index = 0; index < 5; index++) {
    key += XHH_DICT[cursor % XHH_DICT.length];
    cursor = Math.trunc(cursor / XHH_DICT.length);
  }

  const suffix = checksum([...key].slice(-4).map(char => char.codePointAt(0)!))
    .toString()
    .padStart(2, '0');
  const result = new URL(url);
  const query = `hkey=${key}${suffix}&_time=${timestamp}&nonce=${nonce}`;
  result.search += result.search ? `&${query}` : `?${query}`;
  return result.toString();
}

export async function fetchXiaoheiheNews(limit = 20): Promise<XiaoheiheNewsItem[]> {
  try {
    const url = signedUrl(
      `https://api.xiaoheihe.cn/bbs/app/feeds/news?os_type=web&app=heybox&client_type=mobile&version=999.0.3&x_client_type=web&x_os_type=Mac&x_app=heybox&heybox_id=-1&appid=900018355&offset=0&limit=${limit}`
    );
    const response = await axios.get(url, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10_000
    });
    if (response.data.status !== 'ok') {
      console.error('[Community] Xiaoheihe API failed:', response.data.msg);
      return [];
    }
    return (response.data.result?.links || response.data.result?.list || [])
      .filter((item: XiaoheiheNewsItem) => item.linkid !== undefined);
  } catch (error) {
    console.error('[Community] Xiaoheihe error:', (error as Error).message);
    return [];
  }
}
