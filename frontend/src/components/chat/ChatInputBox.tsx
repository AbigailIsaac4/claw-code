import React, { useRef } from 'react';
import { Sender } from '@ant-design/x';
import { AppstoreOutlined, FolderOpenOutlined, PaperClipOutlined, RobotOutlined } from '@ant-design/icons';
import { Popover, Typography } from 'antd';
import { colors } from '@/styles/tokens';

const { Text: AntText } = Typography;

interface SkillInfo {
  name: string;
  description: string;
}

interface Props {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  onSend: () => void;
  agentMode: 'plan' | 'execute';
  setAgentMode: (mode: 'plan' | 'execute') => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  skills: SkillInfo[];
}

export const ChatInputBox: React.FC<Props> = ({
  input,
  setInput,
  loading,
  onSend,
  onFileUpload,
  skills,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const skillsPopover = (
    <Popover
      content={
        <div style={{ maxHeight: 300, overflowY: 'auto', width: 280 }}>
          <AntText type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
            点击插入技能命令 /skill_name
          </AntText>
          {skills.length === 0 ? (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <AntText type="secondary">暂无可用技能</AntText>
            </div>
          ) : (
            skills.map((item) => (
              <div
                key={item.name}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderRadius: 8,
                  transition: 'background 0.2s',
                  marginBottom: 4,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = colors.border; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={() => {
                  const skillName = item.name.includes('/') ? item.name.split('/').pop()! : item.name;
                  setInput((prev) => prev + (prev.trim() ? ' ' : '') + `/${skillName}`);
                }}
              >
                <div style={{ fontWeight: 500, color: colors.accent, marginBottom: 4, fontSize: 13 }}>
                  <RobotOutlined /> {item.name}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.description}
                </div>
              </div>
            ))
          )}
        </div>
      }
      trigger="click"
      placement="topLeft"
    >
      <AppstoreOutlined
        style={{ fontSize: 18, cursor: 'pointer', transition: 'color 0.2s', color: colors.textSecondary }}
        title="打开技能列表"
      />
    </Popover>
  );

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Sender
        value={input}
        onChange={setInput}
        onSubmit={(val) => {
          if (val.trim()) onSend();
        }}
        onCancel={() => {}}
        loading={loading}
        placeholder="从任务或问题开始... 按 Shift + Enter 换行"
        style={{ borderRadius: 12 }}
        prefix={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <PaperClipOutlined
              style={{ fontSize: 18, cursor: 'pointer', transition: 'color 0.2s', color: colors.textSecondary }}
              title="上传文件到当前会话工作区"
              onClick={() => fileInputRef.current?.click()}
            />
            {skillsPopover}
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onFileUpload} />
          </div>
        }
      />
      <div style={{ marginTop: 8, paddingLeft: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <FolderOpenOutlined style={{ fontSize: 14, color: colors.textSecondary }} />
        <AntText type="secondary" style={{ fontSize: 12 }}>当前会话工作区</AntText>
      </div>
    </div>
  );
};
