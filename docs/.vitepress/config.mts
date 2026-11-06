import { defineConfig } from 'vitepress';

type Page = [label: string, slug: string];
type Section = [title: string, pages: Page[]];

const sections: Section[] = [
  [
    'Guide',
    [
      ['Introduction', 'introduction'],
      ['Getting Started', 'getting-started'],
      ['Schema', 'schema'],
      ['Full Example', 'examples'],
      ['VS Code Extension', 'vscode'],
    ],
  ],
  [
    'Client',
    [
      ['Overview', 'overview'],
      ['Queries', 'queries'],
      ['Aggregations', 'aggregations'],
      ['Writes', 'writes'],
      ['Relation Writes', 'relation-writes'],
      ['Transactions', 'transactions'],
      ['Raw SQL', 'raw-sql'],
      ['Soft Delete', 'soft-delete'],
      ['Typed JSON', 'json'],
      ['Virtual Fields', 'virtual-fields'],
      ['Date & Timezone', 'datetime'],
      ['Event Logging', 'logging'],
    ],
  ],
  [
    'Databases',
    [
      ['Capability Matrix', 'overview'],
      ['Database Adapters', 'adapters'],
      ['Versioned Migrations', 'migrations'],
    ],
  ],
  [
    'Reference',
    [
      ['Client API', 'client-api'],
      ['CLI', 'cli'],
      ['Error Codes', 'errors'],
    ],
  ],
];

const zhSectionTitles: Record<string, string> = {
  Guide: '指南',
  Client: '客户端',
  Databases: '数据库',
  Reference: '参考',
};

const zhPageLabels: Record<string, string> = {
  Introduction: '简介',
  'Getting Started': '快速开始',
  Schema: '模型定义',
  'Full Example': '完整示例',
  'VS Code Extension': 'VS Code 扩展',
  Overview: '概览',
  Queries: '查询',
  Aggregations: '聚合与分组',
  Writes: '写入',
  'Relation Writes': '关系写入',
  Transactions: '事务',
  'Raw SQL': '原生 SQL',
  'Soft Delete': '软删除',
  'Typed JSON': '类型化 JSON',
  'Virtual Fields': '虚拟字段',
  'Date & Timezone': '日期与时区',
  'Event Logging': '事件日志',
  'Capability Matrix': '能力对比',
  'Database Adapters': '数据库适配器',
  'Versioned Migrations': '版本化迁移',
  'Client API': '客户端 API',
  'Error Codes': '错误码',
};

const firstPage: Record<string, string> = {
  Guide: 'introduction',
  Client: 'overview',
  Databases: 'overview',
  Reference: 'client-api',
};

function sidebar(prefix: string, locale: 'en' | 'zh') {
  return sections.map(([section, pages]) => ({
    text: locale === 'zh' ? zhSectionTitles[section] : section,
    items: pages.map(([label, slug]) => ({
      text: locale === 'zh' ? (zhPageLabels[label] ?? label) : label,
      link: `${prefix}${section.toLowerCase()}/${slug}`,
    })),
  }));
}

function nav(prefix: string, locale: 'en' | 'zh') {
  return Object.entries(firstPage).map(([section, slug]) => ({
    text: locale === 'zh' ? zhSectionTitles[section] : section,
    link: `${prefix}${section.toLowerCase()}/${slug}`,
    activeMatch: `^${prefix}${section.toLowerCase()}/`,
  }));
}

export default defineConfig({
  lang: 'en-US',
  title: 'TSORM',
  description:
    'Define models with a TypeScript-flavored DSL and access SQLite, MySQL, and PostgreSQL through a type-safe client.',
  base: process.env.DOCS_BASE ?? '/',
  cleanUrls: true,
  markdown: {
    lineNumbers: true,
    container: {
      tipLabel: 'Tip',
      warningLabel: 'Warning',
      dangerLabel: 'Danger',
      infoLabel: 'Note',
      detailsLabel: 'Details',
    },
  },
  themeConfig: {
    logo: { src: `${process.env.DOCS_BASE ?? '/'}logo.svg`, alt: 'TSORM logo' },
    // sidebar is matched by path, so one map covers both locales.
    sidebar: {
      '/': sidebar('/', 'en'),
      '/zh/': sidebar('/zh/', 'zh'),
    },
    // English defaults; zh overrides via locales.zh.themeConfig.
    outline: { level: [2, 3], label: 'On this page' },
    docFooter: { prev: 'Previous page', next: 'Next page' },
    lastUpdated: { text: 'Last updated' },
    sidebarMenuLabel: 'Menu',
    returnToTopLabel: 'Return to top',
    darkModeSwitchLabel: 'Appearance',
    footer: { message: 'Released under the MIT License.', copyright: 'Copyright © 2026 TSORM' },
    search: {
      provider: 'local',
      options: {
        locales: {
          zh: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                displayDetails: '显示详细列表',
                resetButtonTitle: '重置搜索',
                backButtonTitle: '关闭搜索',
                noResultsText: '没有找到结果',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
      },
    },
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      title: 'TSORM',
      description:
        'Define models with a TypeScript-flavored DSL and access SQLite, MySQL, and PostgreSQL through a type-safe client.',
      // nav is a flat array, so it must be provided per locale.
      themeConfig: {
        nav: nav('/', 'en'),
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      title: 'TSORM',
      description: '用 TypeScript 风格的 DSL 定义模型，通过类型安全的客户端访问 SQLite、MySQL 和 PostgreSQL。',
      themeConfig: {
        nav: nav('/zh/', 'zh'),
        outline: { level: [2, 3], label: '本页导航' },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新' },
        sidebarMenuLabel: '目录',
        returnToTopLabel: '返回顶部',
        darkModeSwitchLabel: '切换主题',
      },
    },
  },
});
