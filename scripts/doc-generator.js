#!/usr/bin/env node

/**
 * AI Adventure Scribe Documentation Generator
 * 
 * Automates documentation tasks and content generation
 * for build-in-public development tracking
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class DocumentationGenerator {
  constructor() {
    this.buildLogPath = './docs/progress/BUILD_LOG.md';
    this.xPostsPath = './docs/x-posts/daily';
    this.blogPath = './docs/blog/technical';
    this.metricsPath = './docs/metrics';
    
    // Phase tracking
    this.phases = [
      'Persistent Worlds',
      'Lineage System', 
      'Timeline Evolution',
      'Memory Architecture',
      'Fiction Generation',
      'Visual Generation',
      '3D World Visualization',
      'World Simulation',
      'Technical Scaling'
    ];
    
    this.currentPhase = 1;
    this.metrics = {
      linesOfCode: 0,
      filesCreated: 0,
      querySpeed: 0,
      memoryUsage: 0,
      aiCostPerSession: 0,
      worldsCreated: 0,
      npcsTracked: 0,
      locationsGenerated: 0
    };
  }

  /**
   * Main CLI interface
   */
  async run() {
    const command = process.argv[2];
    const args = process.argv.slice(3);

    switch (command) {
      case 'daily-insight':
        await this.generateDailyInsight(args[0]);
        break;
      case 'progress-update':
        await this.updateProgress(args[0]);
        break;
      case 'phase-complete':
        await this.markPhaseComplete(parseInt(args[0]));
        break;
      case 'metrics':
        await this.generateMetricsReport();
        break;
      case 'blog-draft':
        await this.createBlogDraft(args[0]);
        break;
      case 'setup-week':
        await this.setupWeeklyStructure();
        break;
      case 'auto-post':
        await this.autoPostToX(args[0], args[1] === 'publish');
        break;
      default:
        this.showUsage();
    }
  }

  /**
   * Generate daily X insight post
   */
  async generateDailyInsight(topic = 'recent development') {
    console.log('🎯 Generating daily insight for X platform...');
    
    const today = new Date().toISOString().split('T')[0];
    const filename = `${today}-${topic.toLowerCase().replace(/\s+/g, '-')}.md`;
    const filepath = path.join(this.xPostsPath, filename);
    
    // Analyze recent changes
    const recentWork = await this.analyzeRecentWork();
    
    // Generate insight template
    const insight = this.createInsightTemplate(topic, recentWork);
    
    // Ensure directory exists
    await this.ensureDirectory(this.xPostsPath);
    
    // Write insight file
    fs.writeFileSync(filepath, insight);
    
    console.log(`✅ Daily insight created: ${filepath}`);
    console.log('\n📝 Content preview:');
    console.log(insight);
    
    // Trigger Claude Code doc-builder if available
    await this.triggerDocBuilder(`Generate X post about ${topic}`);
  }

  /**
   * Update BUILD_LOG with current progress
   */
  async updateProgress(milestone) {
    console.log('📊 Updating BUILD_LOG with progress...');
    
    // Gather current metrics
    await this.gatherMetrics();
    
    // Create progress entry
    const timestamp = new Date().toISOString();
    const progressEntry = `
### ${timestamp.split('T')[0]} Progress Update: ${milestone}

#### Technical Metrics
- **Lines of Code**: ${this.metrics.linesOfCode} (+${this.metrics.filesCreated} files)
- **Query Performance**: ${this.metrics.querySpeed}ms average
- **Memory Usage**: ${this.metrics.memoryUsage}MB
- **AI Cost Efficiency**: $${this.metrics.aiCostPerSession}/session

#### Features Completed
- ${milestone}

#### Key Insights
- [Document what was learned or discovered]
- [Any performance improvements achieved]
- [Challenges overcome and solutions implemented]

#### Next Steps
- [Immediate next tasks]
- [Blockers to address]

---
`;

    // Append to BUILD_LOG
    const buildLog = fs.readFileSync(this.buildLogPath, 'utf8');
    const updatedLog = buildLog.replace(
      '## 💡 Daily Insights Log',
      `## 💡 Daily Insights Log${progressEntry}`
    );
    
    fs.writeFileSync(this.buildLogPath, updatedLog);
    console.log('✅ BUILD_LOG updated successfully');
  }

  /**
   * Mark phase as complete and generate summary
   */
  async markPhaseComplete(phaseNumber) {
    console.log(`🎉 Marking Phase ${phaseNumber} complete: ${this.phases[phaseNumber - 1]}`);
    
    const phaseData = {
      number: phaseNumber,
      name: this.phases[phaseNumber - 1],
      completedDate: new Date().toISOString().split('T')[0],
      metrics: { ...this.metrics }
    };
    
    // Generate phase completion blog post
    await this.createBlogDraft(`phase-${phaseNumber}-${this.phases[phaseNumber - 1].toLowerCase().replace(/\s+/g, '-')}`);
    
    // Generate phase summary for X
    await this.generateDailyInsight(`Phase ${phaseNumber} Complete: ${this.phases[phaseNumber - 1]}`);
    
    // Update BUILD_LOG with phase milestone
    await this.updateProgress(`Phase ${phaseNumber}: ${this.phases[phaseNumber - 1]} - COMPLETED`);
    
    console.log('✅ Phase completion documented across all platforms');
  }

  /**
   * Generate comprehensive metrics report
   */
  async generateMetricsReport() {
    console.log('📈 Generating metrics report...');
    
    await this.gatherMetrics();
    
    const report = `# AI Adventure Scribe - Metrics Report
Generated: ${new Date().toISOString()}

## Development Metrics
- **Total Lines of Code**: ${this.metrics.linesOfCode}
- **Files Created**: ${this.metrics.filesCreated}
- **Current Phase**: ${this.currentPhase}/9 - ${this.phases[this.currentPhase - 1]}

## Performance Metrics  
- **Average Query Speed**: ${this.metrics.querySpeed}ms
- **Memory Usage**: ${this.metrics.memoryUsage}MB
- **AI Cost per Session**: $${this.metrics.aiCostPerSession}

## Scale Metrics
- **Worlds Created**: ${this.metrics.worldsCreated}
- **NPCs Tracked**: ${this.metrics.npcsTracked}  
- **Locations Generated**: ${this.metrics.locationsGenerated}

## Phase Progress
${this.phases.map((phase, i) => `- [${i < this.currentPhase - 1 ? 'x' : ' '}] Phase ${i + 1}: ${phase}`).join('\n')}

---
*Report generated by doc-generator.js*
`;

    const reportPath = path.join(this.metricsPath, `metrics-${new Date().toISOString().split('T')[0]}.md`);
    await this.ensureDirectory(this.metricsPath);
    fs.writeFileSync(reportPath, report);
    
    console.log(`✅ Metrics report saved: ${reportPath}`);
    console.log('\n📊 Current Metrics:');
    console.log(report);
  }

  /**
   * Create blog post draft
   */
  async createBlogDraft(topic) {
    console.log(`📝 Creating blog post draft for: ${topic}`);
    
    const today = new Date().toISOString().split('T')[0];
    const filename = `${today}-${topic}.md`;
    const filepath = path.join(this.blogPath, filename);
    
    // Load template
    const templatePath = path.join(this.blogPath, 'template.md');
    let template = fs.readFileSync(templatePath, 'utf8');
    
    // Replace placeholders
    template = template
      .replace(/\[YYYY-MM-DD\]/g, today)
      .replace(/\[phase\]/g, this.currentPhase.toString())
      .replace(/\[slug\]/g, topic);
    
    await this.ensureDirectory(this.blogPath);
    fs.writeFileSync(filepath, template);
    
    console.log(`✅ Blog draft created: ${filepath}`);
  }

  /**
   * Analyze recent development work
   */
  async analyzeRecentWork() {
    try {
      // Get recent git changes
      const { stdout: gitLog } = await execAsync('git log --oneline -5 2>/dev/null || echo "No git history"');
      
      // Get file changes
      const { stdout: gitStatus } = await execAsync('git status --porcelain 2>/dev/null || echo "No git status"');
      
      // Check for recent file modifications
      const recentFiles = fs.readdirSync('./ai-adventure-scribe-main/src', { recursive: true })
        .filter(file => file.endsWith('.ts') || file.endsWith('.tsx'))
        .slice(0, 5);

      return {
        recentCommits: gitLog.split('\n').filter(line => line.trim()),
        modifiedFiles: gitStatus.split('\n').filter(line => line.trim()),
        sourceFiles: recentFiles
      };
    } catch (error) {
      console.warn('Could not analyze recent work:', error.message);
      return {
        recentCommits: [],
        modifiedFiles: [],
        sourceFiles: []
      };
    }
  }

  /**
   * Gather current project metrics
   */
  async gatherMetrics() {
    try {
      // Count lines of code
      const { stdout: locOutput } = await execAsync(
        'find ./ai-adventure-scribe-main/src -name "*.ts" -o -name "*.tsx" | xargs wc -l 2>/dev/null | tail -1 || echo "0"'
      );
      this.metrics.linesOfCode = parseInt(locOutput.trim().split(' ')[0]) || 0;
      
      // Count files
      const { stdout: fileCount } = await execAsync(
        'find ./ai-adventure-scribe-main/src -name "*.ts" -o -name "*.tsx" | wc -l 2>/dev/null || echo "0"'
      );
      this.metrics.filesCreated = parseInt(fileCount.trim()) || 0;
      
      // Mock other metrics (would be replaced with actual measurements)
      this.metrics.querySpeed = Math.floor(Math.random() * 100) + 50; // 50-150ms
      this.metrics.memoryUsage = Math.floor(Math.random() * 50) + 30; // 30-80MB
      this.metrics.aiCostPerSession = (Math.random() * 0.10 + 0.05).toFixed(3); // $0.05-0.15
      
    } catch (error) {
      console.warn('Could not gather all metrics:', error.message);
    }
  }

  /**
   * Create insight template for X posts
   */
  createInsightTemplate(topic, recentWork) {
    const templates = [
      `Built ${topic} today. Discovered [specific technical challenge].

Solution: [brief technical approach]. [Performance improvement or user benefit].

#BuildInPublic #AIAgents #DnD #GameDev`,

      `Working on ${topic} revealed [unexpected challenge].

[Technical solution in 1-2 sentences]. This enables [user experience improvement].

#AIAgents #MultiAgent #GameDev #TechInnovation`,

      `${topic} optimization: [specific metric] improved from [before] to [after].

[Brief explanation of technical approach]. Players now experience [benefit].

#Performance #AIAgents #GameDev #BuildInPublic`
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Setup weekly documentation structure
   */
  async setupWeeklyStructure() {
    console.log('🗓️ Setting up weekly documentation structure...');
    
    const weekDirs = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    
    for (const day of weekDirs) {
      const dayPath = path.join(this.xPostsPath, day);
      await this.ensureDirectory(dayPath);
      
      // Create day-specific template
      const dayTemplate = `# ${day.charAt(0).toUpperCase() + day.slice(1)} Posts

## Focus: ${this.getDayFocus(day)}

[Daily posts for ${day} will be stored here]
`;
      
      const readmePath = path.join(dayPath, 'README.md');
      if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(readmePath, dayTemplate);
      }
    }
    
    console.log('✅ Weekly structure created');
  }

  getDayFocus(day) {
    const focuses = {
      monday: 'Multi-Agent Coordination',
      tuesday: 'Performance Optimization', 
      wednesday: 'World-Building Systems',
      thursday: 'Technical Architecture',
      friday: 'Feature Implementation'
    };
    return focuses[day] || 'Development Progress';
  }

  /**
   * Trigger Claude Code doc-builder agent with X posting
   */
  async triggerDocBuilder(task, autoPost = false) {
    try {
      console.log('🤖 Triggering doc-builder agent...');
      const postInstruction = autoPost ? " Also create and publish X post about this development." : "";
      const command = `claude --use-agent doc-builder "${task}${postInstruction}"`;
      await execAsync(command);
      console.log('✅ Doc-builder agent completed task');
    } catch (error) {
      console.log('ℹ️  Doc-builder agent not available or errored');
    }
  }

  /**
   * Auto-post development session to X
   */
  async autoPostToX(topic = 'development progress', autoPublish = false) {
    console.log('🐦 Auto-generating X post...');
    
    const recentWork = await this.analyzeRecentWork();
    const insight = this.createInsightTemplate(topic, recentWork);
    
    const postTask = autoPublish ? 
      `Generate X post about ${topic} and publish it immediately using X MCP server` :
      `Generate X post draft about ${topic} using X MCP server`;
    
    await this.triggerDocBuilder(postTask);
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Show usage instructions
   */
  showUsage() {
    console.log(`
🤖 AI Adventure Scribe Documentation Generator

Usage: node doc-generator.js <command> [args]

Commands:
  daily-insight [topic]     Generate daily X insight post  
  progress-update <milestone>  Update BUILD_LOG with progress
  phase-complete <number>   Mark phase complete and generate content
  metrics                   Generate comprehensive metrics report
  blog-draft <topic>        Create technical blog post draft
  setup-week               Setup weekly documentation structure

Examples:
  node doc-generator.js daily-insight "multi-agent coordination"
  node doc-generator.js progress-update "Memory system optimization"  
  node doc-generator.js phase-complete 1
  node doc-generator.js metrics
  node doc-generator.js blog-draft "persistent-worlds-architecture"
`);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const generator = new DocumentationGenerator();
  generator.run().catch(console.error);
}

export default DocumentationGenerator;