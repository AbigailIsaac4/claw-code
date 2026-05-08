import React, { useRef } from 'react';
import {
  AppstoreOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { Text } from '@lobehub/ui';
import { Button, Input, Popover, Typography } from 'antd';
import { colors } from '@/styles/tokens';

const { TextArea } = Input;
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
  const isEmpty = !input.trim();

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          background: colors.bgPrimary,
          borderRadius: 12,
          border: '1px solid #e8e8e8',
          boxShadow: colors.shadowMedium,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '12px',
        }}
      >
        <TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="从任务或问题开始... 按 Shift + Enter 换行"
          autoSize={{ minRows: 2, maxRows: 8 }}
          variant="borderless"
          style={{ padding: 0, resize: 'none', fontSize: 14, boxShadow: 'none' }}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 12, color: colors.textSecondary }}>
            <PaperClipOutlined
              style={{ fontSize: 18, cursor: 'pointer', transition: 'color 0.2s' }}
              title="上传文件到当前会话工作区"
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = colors.textPrimary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = colors.textSecondary;
              }}
            />
            <Popover
              content={
                <div style={{ maxHeight: 300, overflowY: 'auto', width: 280 }}>
                  <AntText
                    type="secondary"
                    style={{ display: 'block', fontSize: 13, marginBottom: 8 }}
                  >
                    选择技能并插入到输入框
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
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = colors.border;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                        onClick={() =>
                          setInput((prev) => prev + (prev.trim() ? '\n' : '') + `请使用 ${item.name} 技能`)
                        }
                      >
                        <div
                          style={{
                            fontWeight: 500,
                            color: colors.accent,
                            marginBottom: 4,
                            fontSize: 13,
                          }}
                        >
                          <RobotOutlined /> {item.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: colors.textSecondary,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
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
                style={{ fontSize: 18, cursor: 'pointer', transition: 'color 0.2s' }}
                title="打开技能列表"
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = colors.textPrimary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = colors.textSecondary;
                }}
              />
            </Popover>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={onFileUpload}
            />
          </div>

          <Button
            type="primary"
            shape="circle"
            icon={<SendOutlined />}
            onClick={onSend}
            disabled={isEmpty || loading}
            style={{
              background: isEmpty ? colors.border : colors.accent,
              color: isEmpty ? '#bfbfbf' : '#fff',
              border: 'none',
            }}
          />
        </div>
      </div>
      <div
        style={{
          marginTop: 8,
          paddingLeft: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <FolderOpenOutlined style={{ fontSize: 14, color: colors.textSecondary }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          当前会话工作区
        </Text>
      </div>
    </div>
  );
};
