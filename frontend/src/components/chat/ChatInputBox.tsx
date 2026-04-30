import React, { useRef } from 'react';
import { Button, Input, Segmented, Popover, Typography } from 'antd';
import { SendOutlined, PaperClipOutlined, RobotOutlined, BulbOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { ActionIcon } from '@lobehub/ui';

const { TextArea } = Input;
const { Text } = Typography;

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
  input, setInput, loading, onSend, agentMode, setAgentMode, onFileUpload, skills
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 8px 24px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      {/* Top Action Bar (LobeUI style) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: '#fafafa' }}>
        <div style={{ display: 'flex', gap: 4 }}>
           <ActionIcon icon={PaperClipOutlined} title="上传文件作为上下文" onClick={() => fileInputRef.current?.click()} size="small" />
           
           <Popover 
              content={
                <div style={{ maxHeight: 300, overflowY: 'auto', width: 280 }}>
                  {skills.length === 0 ? (
                    <div style={{ padding: 12, textAlign: 'center' }}><Text type="secondary">暂无可用技能</Text></div>
                  ) : (
                    skills.map(item => (
                      <div 
                        key={item.name}
                        style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', marginBottom: 4 }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f0f0f0'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        onClick={() => setInput(prev => prev + (prev.trim() ? '\n' : '') + `请使用 ${item.name} 技能: `)}
                      >
                        <div style={{ fontWeight: 500, color: '#1677ff', marginBottom: 4, fontSize: 13 }}><RobotOutlined /> {item.name}</div>
                        <div style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.description}</div>
                      </div>
                    ))
                  )}
                </div>
              } 
              title={<span style={{ fontSize: 13, color: '#888' }}>选择技能添加到输入框</span>} 
              trigger="click"
              placement="topLeft"
            >
              <ActionIcon icon={RobotOutlined} title="唤出技能库" size="small" />
            </Popover>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onFileUpload} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
             {agentMode === 'plan' ? '📝 生成计划' : '⚡ 立即执行'}
          </Text>
          <Segmented
            size="small"
            value={agentMode}
            onChange={(val) => setAgentMode(val as 'plan' | 'execute')}
            options={[
              { label: <span><BulbOutlined /> Plan</span>, value: 'plan' },
              { label: <span><ThunderboltOutlined /> Execute</span>, value: 'execute' },
            ]}
          />
        </div>
      </div>

      {/* Input Area */}
      <div style={{ position: 'relative', background: agentMode === 'plan' ? '#fffbe6' : '#fff', transition: 'background 0.3s' }}>
        <TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={agentMode === 'plan' 
            ? '描述你的任务目标，Agent 将分析并生成执行计划（不会执行任何修改）...' 
            : '输入指令，可随时拖入文件上传 (Shift + Enter 换行)...'}
          autoSize={{ minRows: 3, maxRows: 10 }}
          style={{ padding: '16px 16px 48px', border: 'none', background: 'transparent', boxShadow: 'none', resize: 'none', fontSize: 14 }}
        />
        
        <div style={{ position: 'absolute', bottom: 12, right: 16 }}>
           <Button
             type="primary"
             icon={agentMode === 'plan' ? <BulbOutlined /> : <SendOutlined />}
             onClick={onSend}
             loading={loading}
             style={{ 
               background: agentMode === 'plan' ? '#faad14' : '#000', 
               border: 'none', 
               boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'center',
               padding: '0 20px',
               height: 36,
               borderRadius: 18
             }}
           >
             {agentMode === 'plan' ? '生成计划' : '发送'}
           </Button>
        </div>
      </div>
    </div>
  );
};
