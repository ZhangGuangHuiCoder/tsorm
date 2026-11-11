import { defineConfig, type DefaultTheme } from "vitepress";

type Page = [label: string, slug: string];
type Group = [label: string, pages: Page[]];
type Section = [title: string, pages: (Page | Group)[]];

const repository = "https://github.com/ZhangGuangHuiCoder/tsorm";

const base = process.env.DOCS_BASE ?? "/";

// First visit lands on the English root; hop to /zh/ when the browser is
// Chinese and no preference was stored yet. A stored choice disables further
// auto redirects, so manually picking English is respected.
const localeDetectScript = `(function(){try{var b=${JSON.stringify(base)};if(localStorage.getItem("tsorm-locale"))return;var n=(navigator.language||"").toLowerCase();var p=location.pathname.replace(/index\\.html$/,"");if(p.charAt(p.length-1)!=="/")p+="/";if(p!==b)return;if(n.indexOf("zh")===0){localStorage.setItem("tsorm-locale","zh");location.replace(b+"zh/");}}catch(e){}})();`;

const sections: Section[] = [
  [
    "Guide",
    [
      ["Getting Started", "getting-started"],
      ["Introduction", "introduction"],
      ["Documentation Map", "documentation"],
      ["Full Example", "examples"],
      ["Development & Validation", "development"],
      ["VS Code Extension", "vscode"],
    ],
  ],
  [
    "Schema",
    [
      ["Models and Fields", "overview"],
      ["Model Attributes", "attributes"],
      [
        "Relations",
        [
          ["Relation Overview", "relations/overview"],
          ["One-to-Many", "relations/one-to-many"],
          ["One-to-One", "relations/one-to-one"],
          ["Many-to-Many", "relations/many-to-many"],
          ["Polymorphic Relations", "relations/polymorphic"],
          ["Foreign Key Fields", "relations/foreign-keys"],
          ["Referential Actions", "relations/referential-actions"],
          ["Self-Relations", "relations/self-relations"],
          ["Multiple Relations", "relations/multiple-relations"],
        ],
      ],
      ["Typed JSON", "json"],
      ["Soft Delete", "soft-delete"],
    ],
  ],
  [
    "Client",
    [
      ["Overview", "overview"],
      [
        "Reading Data",
        [
          ["Queries", "queries"],
          ["Aggregations", "aggregations"],
        ],
      ],
      [
        "Writing Data",
        [
          ["Create", "create"],
          ["Update", "update"],
          ["Delete", "delete"],
          ["Relation Writes", "relation-writes"],
        ],
      ],
      ["Transactions", "transactions"],
      ["Raw SQL", "raw-sql"],
      [
        "Configuration & Extensions",
        [
          ["Date & Timezone", "datetime"],
          ["Extensions", "extensions"],
          ["Virtual Fields", "virtual-fields"],
          ["Event Logging", "logging"],
        ],
      ],
    ],
  ],
  [
    "Databases",
    [
      ["Capability Matrix", "overview"],
      [
        "Adapters",
        [
          ["Adapter Overview", "adapters/overview"],
          ["SQLite", "adapters/sqlite"],
          ["MySQL / MariaDB", "adapters/mysql"],
          ["PostgreSQL", "adapters/postgres"],
        ],
      ],
      ["Versioned Migrations", "migrations"],
    ],
  ],
  [
    "Reference",
    [
      ["Client API", "client-api"],
      [
        "CLI",
        [
          ["CLI Overview", "cli/overview"],
          ["Options & Behavior", "cli/options"],
          ["Command Examples", "cli/commands"],
          ["Calling from Code", "cli/programmatic"],
        ],
      ],
      ["Error Codes", "errors"],
    ],
  ],
];

const zhSectionTitles: Record<string, string> = {
  Guide: "入门与开发",
  Schema: "模型定义",
  Client: "客户端",
  Databases: "数据库",
  Reference: "API 参考",
};

const zhPageLabels: Record<string, string> = {
  Introduction: "项目概述",
  "Documentation Map": "文档导航",
  "Development & Validation": "开发与验证",
  "Getting Started": "快速开始",
  "Full Example": "完整示例",
  "VS Code Extension": "VS Code 扩展",
  "Models and Fields": "模型与字段",
  Relations: "关系",
  "Relation Overview": "关系概览",
  "One-to-Many": "一对多",
  "One-to-One": "一对一",
  "Many-to-Many": "多对多",
  "Foreign Key Fields": "外键字段",
  "Referential Actions": "参照动作",
  "Self-Relations": "自关联",
  "Multiple Relations": "多个关系",
  "Model Attributes": "模型属性",
  Overview: "概览",
  "Reading Data": "数据查询",
  "Writing Data": "数据写入",
  "Configuration & Extensions": "配置与扩展",
  Create: "新增",
  Queries: "查询",
  Update: "更新",
  Delete: "删除",
  Aggregations: "聚合与分组",
  "Relation Writes": "关系写入",
  Transactions: "事务",
  "Raw SQL": "原生 SQL",
  "Soft Delete": "软删除",
  "Polymorphic Relations": "多态关联",
  "Typed JSON": "类型化 JSON",
  "Virtual Fields": "虚拟字段",
  Extensions: "扩展",
  "Date & Timezone": "日期与时区",
  "Event Logging": "事件日志",
  "Capability Matrix": "能力对比",
  Adapters: "适配器",
  "Adapter Overview": "适配器概览",
  SQLite: "SQLite",
  "MySQL / MariaDB": "MySQL / MariaDB",
  PostgreSQL: "PostgreSQL",
  "Versioned Migrations": "版本化迁移",
  "Client API": "客户端 API",
  "CLI Overview": "CLI 概览",
  "Options & Behavior": "选项与行为",
  "Command Examples": "命令示例",
  "Calling from Code": "在代码中调用",
  "Error Codes": "错误码",
};

const firstPage: Record<string, string> = {
  Guide: "getting-started",
  Schema: "overview",
  Client: "overview",
  Databases: "overview",
  Reference: "client-api",
};

function sectionPath(prefix: string, section: string): string {
  return `${prefix}${section.toLowerCase()}/`;
}

function sidebarItems(prefix: string, locale: "en" | "zh", pages: (Page | Group)[]): DefaultTheme.SidebarItem[] {
  return pages.map(([label, target]) => {
    const text = locale === "zh" ? (zhPageLabels[label] ?? label) : label;
    if (typeof target === "string") {
      return { text, link: `${prefix}${target}` };
    }
    return { text, collapsed: false, items: sidebarItems(prefix, locale, target) };
  });
}

// vitepress.dev scopes the sidebar to the section being read: guide pages list
// under the guide, reference pages under the reference.
function sidebar(prefix: string, locale: "en" | "zh"): DefaultTheme.SidebarMulti {
  const map: DefaultTheme.SidebarMulti = {};
  for (const [section, pages] of sections) {
    const path = sectionPath(prefix, section);
    map[path] = [
      {
        text: locale === "zh" ? zhSectionTitles[section] : section,
        collapsed: false,
        items: sidebarItems(path, locale, pages),
      },
    ];
  }
  return map;
}

function nav(prefix: string, locale: "en" | "zh") {
  return ["Guide", "Schema", "Client", "Databases", "Reference"]
    .map((section) => [section, firstPage[section]])
    .map(([section, slug]) => ({
      text: locale === "zh" ? zhSectionTitles[section] : section,
      link: `${sectionPath(prefix, section)}${slug}`,
      activeMatch: `^${sectionPath(prefix, section)}`,
    }));
}

export default defineConfig({
  lang: "en-US",
  title: "TSORM",
  description: "Define models with a TypeScript-flavored DSL and access SQLite, MySQL, and PostgreSQL through a type-safe client.",
  base,
  cleanUrls: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}logo.svg` }],
    ["script", {}, localeDetectScript],
  ],
  markdown: {
    lineNumbers: true,
    container: {
      tipLabel: "Tip",
      warningLabel: "Warning",
      dangerLabel: "Danger",
      infoLabel: "Note",
      detailsLabel: "Details",
    },
  },
  themeConfig: {
    logo: { src: "/logo.svg", alt: "TSORM logo" },
    // sidebar is matched by path, so one map covers both locales.
    sidebar: {
      ...sidebar("/", "en"),
      ...sidebar("/zh/", "zh"),
    },
    // English defaults; zh overrides via locales.zh.themeConfig.
    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous page", next: "Next page" },
    lastUpdated: { text: "Last updated" },
    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Return to top",
    darkModeSwitchLabel: "Appearance",
    lightModeSwitchTitle: "Switch to light theme",
    darkModeSwitchTitle: "Switch to dark theme",
    navMenuLabel: "Main Navigation",
    mobileMenuLabel: "Menu",
    extraMenuLabel: "More options",
    skipToContentLabel: "Skip to content",
    langMenuLabel: "Change language",
    externalLinkIcon: true,
    socialLinks: [{ icon: "github", link: repository, ariaLabel: "GitHub" }],
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    notFound: {
      title: "PAGE NOT FOUND",
      quote: "The page you are looking for does not exist.",
      linkText: "Take me home",
      linkLabel: "go to home",
    },
    footer: { copyright: "Licensed under the Apache License 2.0. Copyright © 2026 TSORM" },
    search: {
      provider: "local",
      options: {
        locales: {
          zh: {
            translations: {
              button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
              modal: {
                displayDetails: "显示详细列表",
                resetButtonTitle: "重置搜索",
                backButtonTitle: "关闭搜索",
                noResultsText: "没有找到结果",
                footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" },
              },
            },
          },
        },
      },
    },
  },
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      title: "TSORM",
      description: "Define models with a TypeScript-flavored DSL and access SQLite, MySQL, and PostgreSQL through a type-safe client.",
      // nav is a flat array, so it must be provided per locale.
      themeConfig: {
        nav: nav("/", "en"),
      },
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      title: "TSORM",
      description: "用 TypeScript 风格的 DSL 定义模型，通过类型安全的客户端访问 SQLite、MySQL 和 PostgreSQL。",
      themeConfig: {
        nav: nav("/zh/", "zh"),
        outline: { level: [2, 3], label: "本页导航" },
        docFooter: { prev: "上一页", next: "下一页" },
        lastUpdated: { text: "最后更新" },
        sidebarMenuLabel: "目录",
        returnToTopLabel: "返回顶部",
        darkModeSwitchLabel: "切换主题",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式",
        navMenuLabel: "主导航",
        mobileMenuLabel: "菜单",
        extraMenuLabel: "更多选项",
        skipToContentLabel: "跳到正文",
        langMenuLabel: "切换语言",
        editLink: { text: "在 GitHub 上编辑此页" },
        notFound: {
          title: "页面不存在",
          quote: "你访问的页面不存在。",
          link: "/zh/",
          linkText: "返回首页",
          linkLabel: "返回首页",
        },
      },
      markdown: {
        container: {
          infoLabel: "注意",
          noteLabel: "说明",
          tipLabel: "提示",
          warningLabel: "警告",
          dangerLabel: "危险",
          detailsLabel: "详细信息",
          importantLabel: "重要",
          cautionLabel: "小心",
        },
        codeCopyButton: { tooltipText: "复制代码", copiedText: "已复制" },
      },
    },
  },
});
