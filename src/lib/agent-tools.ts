// Custom tool definitions

// Tools for content agents (CMO, CPO, Growth, IR)
export const CONTENT_TOOLS = [
  {
    type: 'custom',
    name: 'save_to_notion',
    description: 'Saves content to a Notion database for founder review. Always use this before email_founder. Specify which database: blog, social, investor, competitor, or digest.',
    input_schema: {
      type: 'object',
      properties: {
        database: { type: 'string', enum: ['blog', 'social', 'investor', 'competitor', 'digest'] },
        title: { type: 'string' },
        content: { type: 'string' },
        properties: { type: 'object', description: 'Additional database properties as key-value pairs' },
      },
      required: ['database', 'title', 'content'],
    },
  },
  {
    type: 'custom',
    name: 'publish_to_ghost',
    description: 'Publishes an approved blog post from Notion to Ghost CMS. Only call this when the Notion status is Approved. Ghost will automatically email the post to subscribers.',
    input_schema: {
      type: 'object',
      properties: {
        notion_page_id: { type: 'string', description: 'The Notion page ID of the approved draft' },
        title: { type: 'string' },
        html: { type: 'string', description: 'Full HTML content of the post' },
        tags: { type: 'array', items: { type: 'string' } },
        send_email_newsletter: { type: 'boolean', description: 'Whether to email post to subscribers. Default true.' },
      },
      required: ['notion_page_id', 'title', 'html'],
    },
  },
  {
    type: 'custom',
    name: 'post_to_twitter',
    description: 'Posts a tweet to the product Twitter/X account. Only call after content is in Notion and approved. Returns posted tweet URL.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Tweet text, max 280 characters' },
      },
      required: ['text'],
    },
  },
  {
    type: 'custom',
    name: 'post_to_linkedin',
    description: 'Posts to the product LinkedIn company page. Only call after content is in Notion and approved.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Post text, max 3000 characters' },
      },
      required: ['text'],
    },
  },
  {
    type: 'custom',
    name: 'email_founder',
    description: 'Sends an email alert to the founder. Always call this after saving to Notion. Subject must start with [REVIEW REQUIRED].',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string', description: 'Include the Notion link where content can be reviewed' },
      },
      required: ['subject', 'body'],
    },
  },
  {
    type: 'custom',
    name: 'request_telegram_approval',
    description: 'Sends the founder a Telegram message with a link to the Notion draft and Approve/Reject buttons. Use this INSTEAD of email_founder whenever possible — email delivery is currently unreliable. Call AFTER save_to_notion, passing the notion_page_id and notion_url returned from that tool. Do not wait for the decision — this tool returns immediately and approval is applied asynchronously (the Notion Status flips to Approved or Rejected when the founder taps a button).',
    input_schema: {
      type: 'object',
      properties: {
        notion_page_id: { type: 'string', description: 'The Notion page ID from save_to_notion result (the UUID with dashes)' },
        notion_url: { type: 'string', description: 'The full Notion page URL from save_to_notion result' },
        title: { type: 'string', description: 'Short title for the Telegram message (e.g. "Tweet: Mobile fraud alert")' },
        preview: { type: 'string', description: 'Optional 1-3 sentence preview so the founder can gauge the content without opening Notion' },
      },
      required: ['notion_page_id', 'notion_url', 'title'],
    },
  },
];

// Tools for the Code Agent
export const CODE_TOOLS = [
  {
    type: 'custom',
    name: 'gh_list_dir',
    description: 'Lists files and subdirectories at a path in the repo. Pass empty string for root. Returns array of items with name, type (file/dir), and path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path, or empty string for repo root' },
      },
      required: ['path'],
    },
  },
  {
    type: 'custom',
    name: 'gh_read_file',
    description: 'Reads the contents of a file from the repo. Returns the full text content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to repo root' },
      },
      required: ['path'],
    },
  },
  {
    type: 'custom',
    name: 'gh_create_branch',
    description: 'Creates a new branch off main. Branch name must start with "agent/" and use kebab-case.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Branch name, e.g. agent/feature-dark-mode-toggle' },
      },
      required: ['name'],
    },
  },
  {
    type: 'custom',
    name: 'gh_commit_file',
    description: 'Creates or updates a file on a branch with a commit message. The content must be the complete file — partial edits are not supported.',
    input_schema: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Branch to commit to' },
        path: { type: 'string', description: 'File path relative to repo root' },
        content: { type: 'string', description: 'Full file content' },
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['branch', 'path', 'content', 'message'],
    },
  },
  {
    type: 'custom',
    name: 'gh_create_pr',
    description: 'Opens a pull request from the given branch back to main. Returns the PR URL.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'PR title' },
        body: { type: 'string', description: 'PR description in markdown' },
        branch: { type: 'string', description: 'Head branch (the one with your changes)' },
      },
      required: ['title', 'body', 'branch'],
    },
  },
  {
    type: 'custom',
    name: 'notify_founder',
    description: 'Sends a Telegram message to the founder. Use this after opening a PR to share the URL, or to ask clarification questions for ambiguous requests.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to send' },
      },
      required: ['message'],
    },
  },
];

// Back-compat alias
export const CUSTOM_TOOLS = CONTENT_TOOLS;
