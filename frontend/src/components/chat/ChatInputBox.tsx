import React, { useRef } from 'react';
import { SendOutlined, PaperClipOutlined, RobotOutlined, AppstoreOutlined, CloudOutlined } from '@ant-design/icons';
import { Button, Popover, Typography, Input } from 'antd';

const { Text } = Typography;
const { TextArea } = Input;

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
  input, setInput, loading, onSend, onFileUpload, skills
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEmpty = !input.trim();

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        background: '#fff', 
        borderRadius: 12, 
        border: '1px solid #e8e8e8', 
        boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden',
        padding: '12px'
      }}>
        <TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="从任何想法开始... 按 Ctrl Enter 换行..."
          autoSize={{ minRows: 2, maxRows: 8 }}
          bordered={false}
          style={{ padding: 0, resize: 'none', fontSize: 14, boxShadow: 'none' }}
        />
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, color: '#888' }}>
            <PaperClipOutlined 
               style={{ fontSize: 18, cursor: 'pointer', transition: 'color 0.2s' }} 
               title="上传文件作为上下文" 
               onClick={() => fileInputRef.current?.click()} 
               onMouseEnter={e => e.currentTarget.style.color = '#333'}
               onMouseLeave={e => e.currentTarget.style.color = '#888'}
            />
            <Popover 
               content={
                <div style={{ maxHeight: 300, overflowY: 'auto', width: 280 }}>
                  <Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
                    选择技能添加到输入框
                  </Text>
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
                        <div style={{ fontWeight: 500, color: '#eb6f4b', marginBottom: 4, fontSize: 13 }}><RobotOutlined /> {item.name}</div>
                        <div style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.description}</div>
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
                 title="唤出技能库" 
                 onMouseEnter={e => e.currentTarget.style.color = '#333'}
                 onMouseLeave={e => e.currentTarget.style.color = '#888'}
               />
             </Popover>
             <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onFileUpload} />
          </div>

          <Button
            type="primary"
            shape="circle"
            icon={<SendOutlined />}
            onClick={onSend}
            disabled={isEmpty || loading}
            style={{ 
              background: isEmpty ? '#f0f0f0' : '#eb6f4b', 
              color: isEmpty ? '#bfbfbf' : '#fff',
              border: 'none', 
            }}
          />
        </div>
      </div>
      <div style={{ marginTop: 8, paddingLeft: 4, display: 'flex', alignItems: 'center', gap: 6, color: '#aaa', fontSize: 12 }}>
        <CloudOutlined style={{ fontSize: 14 }} /> <span>云端沙箱</span>
      </div>
    </div>
  );
};
