import React, { useRef } from 'react';
import { Sender } from '@ant-design/x';
import { AppstoreOutlined, PaperClipOutlined, RobotOutlined } from '@ant-design/icons';
import { Popover, Typography, theme } from 'antd';

const { Text: AntText } = Typography;
const { useToken } = theme;

interface SkillInfo {
  name: string;
  description: string;
}

interface Props {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  onSend: (message?: string) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  skills: SkillInfo[];
}

export const ChatInputBox: React.FC<Props> = ({
  input, setInput, loading, onSend, onFileUpload, skills,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { token } = useToken();

  return (
    <Sender
      value={input}
      onChange={setInput}
      onSubmit={(val) => { if (val.trim()) onSend(val); }}
      onCancel={() => {}}
      loading={loading}
      placeholder="从任务或问题开始... 按 Shift + Enter 换行"
      style={{ maxWidth: 860, margin: '0 auto', borderRadius: token.borderRadiusLG }}
      prefix={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PaperClipOutlined
            style={{ fontSize: 18, cursor: 'pointer', color: token.colorTextQuaternary }}
            title="上传文件"
            onClick={() => fileInputRef.current?.click()}
          />
          <Popover
            content={
              <div style={{ maxHeight: 300, overflowY: 'auto', width: 280 }}>
                <AntText type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>点击插入 /skill_name</AntText>
                {skills.length === 0 ? (
                  <div style={{ padding: 12, textAlign: 'center' }}><AntText type="secondary">暂无可用技能</AntText></div>
                ) : skills.map((item) => {
                  const skillName = item.name.includes('/') ? item.name.split('/').pop()! : item.name;
                  return (
                    <div key={item.name} style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: token.borderRadius, marginBottom: 4 }}
                      onMouseEnter={e => { e.currentTarget.style.background = token.colorFillTertiary; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      onClick={() => setInput(prev => prev + (prev.trim() ? ' ' : '') + `/${skillName}`)}>
                      <div style={{ fontWeight: 500, color: token.colorPrimary, marginBottom: 4, fontSize: 13 }}><RobotOutlined /> {item.name}</div>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.description}</div>
                    </div>
                  );
                })}
              </div>
            }
            trigger="click"
            placement="topLeft"
          >
            <AppstoreOutlined style={{ fontSize: 18, cursor: 'pointer', color: token.colorTextQuaternary }} title="Skills" />
          </Popover>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onFileUpload} />
        </div>
      }
    />
  );
};
